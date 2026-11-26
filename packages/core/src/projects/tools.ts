import { TeamError } from '../team/error.js';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { TASK_STATES } from '@botharness/host-protocol/projects';
import type { PersonaBotRecord } from '../bots/persona-bot.js';
import { readWorker } from '../memory/workers.js';
import type { ProjectStore } from './store.js';

export function projectToolsFor(
  store: ProjectStore,
  bot: () => PersonaBotRecord | undefined,
  isHostOwner: (bot: PersonaBotRecord) => boolean,
  memoryDir: (slug: string) => string | undefined,
  catalog = false,
): ToolDefinition[] {
  const allowed = (record: PersonaBotRecord | undefined): record is PersonaBotRecord =>
    record?.kind === 'assistant' && isHostOwner(record);
  if (!catalog && !allowed(bot())) return [];
  const requireAssistant = () => {
    const record = bot();
    if (!allowed(record)) throw new TeamError('permission-required');
    return record;
  };
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  };
  return [
    defineTool({
      name: 'project_create',
      description: 'Create a project in the Host project board.',
      parameters: {
        name: { type: 'string', required: true },
        instructions: { type: 'string' },
        cwd: {
          type: 'string',
          description: 'Optional absolute working directory for project metadata.',
        },
      },
      output,
      execute: async (args) => {
        requireAssistant();
        return JSON.stringify({ project: store.createProject(args) });
      },
    }),
    defineTool({
      name: 'task_create',
      description:
        'Add a task to the project board. Omit worker_id to use your default worker when work starts.',
      parameters: {
        project_id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        brief: { type: 'string', required: true },
        worker_id: { type: 'string', description: 'Optional worker id from your Bot Memory.' },
      },
      output,
      execute: async ({ project_id, title, brief, worker_id }) => {
        const bot = requireAssistant();
        if (worker_id !== undefined) readWorker(memoryDir(bot.slug), worker_id);
        return JSON.stringify({
          task: store.createTask({ projectId: project_id, title, brief, workerId: worker_id }),
        });
      },
    }),
    defineTool({
      name: 'task_list',
      description: 'List tasks in a project and optionally filter by state.',
      parameters: {
        project_id: { type: 'string', required: true },
        state: { type: 'string', enum: TASK_STATES },
      },
      output,
      execute: async ({ project_id, state }) => {
        requireAssistant();
        return JSON.stringify({ tasks: store.listTasks({ projectId: project_id, state }) });
      },
    }),
  ];
}
