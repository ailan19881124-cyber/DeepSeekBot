import type { SchemaMigration } from '../schema.js';

export const PROJECTS_MIGRATION: SchemaMigration = {
  id: 'projects-and-tasks',
  module: 'projects',
  description: 'Store projects and their revisioned Kanban tasks',
  migrate(database) {
    database.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        instructions TEXT NOT NULL DEFAULT '',
        cwd TEXT,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title TEXT NOT NULL,
        brief TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('todo', 'doing', 'review', 'done', 'failed')),
        assignee_worker_id TEXT,
        channel_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0)
      );
      CREATE INDEX tasks_project_state ON tasks(project_id, state, updated_at);
    `);
  },
};
