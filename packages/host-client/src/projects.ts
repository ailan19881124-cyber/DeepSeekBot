import {
  TASK_STATES,
  type Project,
  type ProjectSummary,
  type ProjectTask,
  type TaskState,
} from '@botharness/host-protocol/projects';
import { optional, answer, answerRecord, count, record, text, type HostCall } from './host-answer';

const nullableText = (value: unknown) => value === null || text(value);
function isProject(value: unknown): value is Project {
  const row = record(value);
  return (
    row !== undefined &&
    text(row.id) &&
    text(row.name) &&
    text(row.instructions) &&
    nullableText(row.cwd) &&
    text(row.createdAt) &&
    nullableText(row.archivedAt)
  );
}
function isProjectSummary(value: unknown): value is ProjectSummary {
  const row = record(value);
  return isProject(value) && count(row?.taskCount) && text(row.updatedAt);
}
function isTask(value: unknown): value is ProjectTask {
  const row = record(value);
  return (
    row !== undefined &&
    [row.id, row.projectId, row.title, row.brief, row.createdAt, row.updatedAt].every(text) &&
    TASK_STATES.some((state) => state === row.state) &&
    nullableText(row.assigneeWorkerId) &&
    nullableText(row.channelId) &&
    optional(row.launchError, nullableText) &&
    count(row.revision)
  );
}

export function projectActions(host: HostCall) {
  const call = async (action: string, input?: unknown) =>
    answerRecord(
      await host.call('projectOperation', { action, ...(input === undefined ? {} : { input }) }),
      'projectOperation',
    );
  return {
    async list() {
      const { projects } = await call('project-list');
      return answer(
        projects,
        (value): value is ProjectSummary[] => Array.isArray(value) && value.every(isProjectSummary),
        'project-list',
      );
    },
    async create(name: string, instructions: string) {
      return answer(
        (await call('project-create', { name, instructions })).project,
        isProject,
        'project-create',
      );
    },
    async show(id: string) {
      return answer((await call('project-show', id)).project, isProject, 'project-show');
    },
    async tasks(projectId: string) {
      const { tasks } = await call('task-list', { projectId });
      return answer(
        tasks,
        (value): value is ProjectTask[] => Array.isArray(value) && value.every(isTask),
        'task-list',
      );
    },
    async createTask(
      projectId: string,
      title: string,
      brief: string,
      workerId?: string,
      bot?: string,
    ) {
      return answer(
        (
          await call('task-create', {
            projectId,
            title,
            brief,
            ...(workerId ? { workerId, ...(bot ? { bot } : {}) } : {}),
          })
        ).task,
        isTask,
        'task-create',
      );
    },
    async updateTask(id: string, state: TaskState, expectedRevision: number) {
      return answer(
        (await call('task-update', { id, state, expectedRevision })).task,
        isTask,
        'task-update',
      );
    },
  };
}

export type ProjectActions = ReturnType<typeof projectActions>;
