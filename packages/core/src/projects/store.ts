import { latestProjectAssignmentState } from './assignment-lifecycle.js';
import { workerIdSchema } from '../memory/workers.js';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  TASK_STATES,
  TASK_TRANSITIONS,
  type Project,
  type ProjectSummary,
  type ProjectTask,
} from '@botharness/host-protocol/projects';
import { OperationalDatabaseError, type OperationalDatabaseModulePort } from '../database/owner.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const id = text(128);
const state = z.enum(TASK_STATES);
const projectInput = z.strictObject({
  name: text(150),
  instructions: z.string().max(256_000).optional(),
  cwd: z
    .string()
    .max(4096)
    .refine((path) => isAbsolute(path) && !path.includes('\0'))
    .optional(),
});
const taskInput = z.strictObject({
  projectId: id,
  title: text(150),
  brief: text(32_000),
  workerId: workerIdSchema.optional(),
  bot: id.optional(),
});
const filterInput = z.strictObject({ projectId: id, state: state.optional() });
const updateInput = z.strictObject({
  id,
  state,
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

const PROJECT_COLUMNS =
  'id, name, instructions, cwd, created_at AS createdAt, archived_at AS archivedAt';
const TASK_COLUMNS = `id, project_id AS projectId, title, brief, state, assignee_worker_id AS assigneeWorkerId,
  channel_id AS channelId, launch_error AS launchError, created_at AS createdAt, updated_at AS updatedAt, revision`;

export class ProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

export function createProjectStore(db: OperationalDatabaseModulePort, now = () => new Date()) {
  const write = <T>(command: (connection: DatabaseSync) => T): T => {
    try {
      return db.transaction(command, ['projects']);
    } catch (error) {
      if (error instanceof OperationalDatabaseError && error.cause instanceof ProjectError)
        throw error.cause;
      throw error;
    }
  };
  return {
    createProject(raw: unknown): Project {
      const input = projectInput.parse(raw);
      const project: Project = {
        id: randomUUID(),
        name: input.name,
        instructions: input.instructions ?? '',
        cwd: input.cwd ?? null,
        createdAt: now().toISOString(),
        archivedAt: null,
      };
      write((sql) =>
        sql
          .prepare(
            'INSERT INTO projects (id, name, instructions, cwd, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(project.id, project.name, project.instructions, project.cwd, project.createdAt),
      );
      return project;
    },
    listProjects(): ProjectSummary[] {
      return db.read(
        (sql) =>
          sql
            .prepare(`
        SELECT ${PROJECT_COLUMNS}, (SELECT COUNT(*) FROM tasks WHERE project_id = projects.id) AS taskCount,
          MAX(created_at, COALESCE((SELECT MAX(updated_at) FROM tasks WHERE project_id = projects.id), created_at)) AS updatedAt
        FROM projects ORDER BY updatedAt DESC, id
      `)
            .all() as unknown as ProjectSummary[],
      );
    },
    showProject(value: unknown): Project {
      const projectId = id.parse(value);
      const project = db.read(
        (sql) =>
          sql
            .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
            .get(projectId) as unknown as Project | undefined,
      );
      if (!project) throw new ProjectError('project-not-found', 'Unknown project.');
      return project;
    },
    recordLaunch(id: string, result: { sessionId: string } | { error: string }): ProjectTask {
      return write((sql) => {
        if ('sessionId' in result) {
          const state = latestProjectAssignmentState(sql, result.sessionId);
          sql
            .prepare(`
            UPDATE tasks SET channel_id = ?, state = CASE WHEN state IN ('todo', 'doing') THEN ? ELSE state END,
              launch_error = NULL, updated_at = ?, revision = revision + 1 WHERE id = ? AND channel_id IS NULL
          `)
            .run(result.sessionId, state, now().toISOString(), id);
        } else {
          sql
            .prepare(`
            UPDATE tasks SET launch_error = ?, updated_at = ?, revision = revision + 1
              WHERE id = ? AND channel_id IS NULL
          `)
            .run(result.error, now().toISOString(), id);
        }
        return sql
          .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
          .get(id) as unknown as ProjectTask;
      });
    },
    createTask(raw: unknown): ProjectTask {
      const input = taskInput.parse(raw);
      const at = now().toISOString();
      const task: ProjectTask = {
        id: randomUUID(),
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        state: 'todo',
        assigneeWorkerId: input.workerId ?? null,
        channelId: null,
        launchError: null,
        createdAt: at,
        updatedAt: at,
        revision: 1,
      };
      write((sql) => {
        const project = sql
          .prepare('SELECT archived_at FROM projects WHERE id = ?')
          .get(task.projectId);
        if (!project) throw new ProjectError('project-not-found', 'Unknown project.');
        if (project.archived_at !== null)
          throw new ProjectError('project-archived', 'This project is archived.');
        sql
          .prepare(`
          INSERT INTO tasks (id, project_id, title, brief, state, assignee_worker_id, channel_id, created_at, updated_at, revision)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .run(
            task.id,
            task.projectId,
            task.title,
            task.brief,
            task.state,
            task.assigneeWorkerId,
            task.channelId,
            task.createdAt,
            task.updatedAt,
            task.revision,
          );
      });
      return task;
    },
    listTasks(raw: unknown): ProjectTask[] {
      const input = filterInput.parse(raw);
      return db.read((sql) => {
        if (!sql.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId))
          throw new ProjectError('project-not-found', 'Unknown project.');
        const query = `SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id = ?`;
        return (input.state === undefined
          ? sql.prepare(query + ' ORDER BY created_at, id').all(input.projectId)
          : sql
              .prepare(query + ' AND state = ? ORDER BY created_at, id')
              .all(input.projectId, input.state)) as unknown as ProjectTask[];
      });
    },
    updateTask(raw: unknown): ProjectTask {
      const input = updateInput.parse(raw);
      return write((sql) => {
        const task = sql
          .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
          .get(input.id) as unknown as ProjectTask | undefined;
        if (!task) throw new ProjectError('task-not-found', 'Unknown task.');
        if (input.expectedRevision !== undefined && input.expectedRevision !== task.revision)
          throw new ProjectError(
            'revision-conflict',
            'This task changed. Reload it before updating.',
          );
        if (input.state === task.state) return task;
        if (!TASK_TRANSITIONS[task.state].includes(input.state))
          throw new ProjectError(
            'invalid-transition',
            `Cannot move a task from ${task.state} to ${input.state}.`,
          );
        const updated = {
          ...task,
          state: input.state,
          revision: task.revision + 1,
          updatedAt: now().toISOString(),
        };
        sql
          .prepare('UPDATE tasks SET state = ?, revision = ?, updated_at = ? WHERE id = ?')
          .run(updated.state, updated.revision, updated.updatedAt, task.id);
        return updated;
      });
    },
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
