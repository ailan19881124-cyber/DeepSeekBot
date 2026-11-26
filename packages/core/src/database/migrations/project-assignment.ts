import type { SchemaMigration } from '../schema.js';

export const PROJECT_ASSIGNMENT_MIGRATION: SchemaMigration = {
  id: 'project-task-assignment',
  module: 'projects',
  description: 'Record project task launch failures and index Assignment links',
  migrate(database) {
    database.exec(`
      ALTER TABLE tasks ADD COLUMN launch_error TEXT;
      CREATE UNIQUE INDEX tasks_assignment_link ON tasks(channel_id) WHERE channel_id IS NOT NULL;
    `);
  },
};
