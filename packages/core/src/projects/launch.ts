import { resolve } from 'node:path';
import type { PersonaBotRegistry } from '../bots/registry.js';
import type { HumanContext } from '../humans/context.js';
import type { BotRuntime } from '../runtime/bot-runtime.js';
import type { WorkspaceGrantStore } from '../workspaces/grants.js';
import { readWorker, listWorkers } from '../memory/workers.js';
import type { Project, ProjectTask } from '@botharness/host-protocol/projects';
import { asObject } from '../bridge/method-utils.js';

export async function launchProjectAssignment(
  deps: {
    registry: PersonaBotRegistry;
    runtime: BotRuntime | undefined;
    grants: WorkspaceGrantStore | undefined;
  },
  human: HumanContext,
  project: Project,
  task: ProjectTask,
  input: unknown,
): Promise<string> {
  const worker = task.assigneeWorkerId;
  if (!worker || !deps.runtime?.runDirectBotTool)
    throw new Error('Assignment execution requires a running Host.');
  const slug = asObject(input).bot;
  const bots = deps.registry.list(human.humanId).filter((bot) => !bot.paused);
  const bot =
    typeof slug === 'string'
      ? bots.find((bot) => bot.slug === slug)
      : (() => {
          const matches = bots.filter((bot) => {
            const root = deps.registry.memoryDirFor(bot.slug);
            return root && listWorkers(root).some((template) => template.id === worker);
          });
          if (matches.length > 1)
            throw new Error('Worker id is ambiguous. Choose its Bot with --bot.');
          return matches[0];
        })();
  if (!bot) throw new Error('No active Bot with this worker was found.');
  readWorker(deps.registry.memoryDirFor(bot.slug), worker);
  const grants = (deps.grants?.list(bot.slug) ?? []).filter((grant) => !grant.revokedAt);
  const eligible =
    project.cwd === null
      ? grants
      : grants.filter((grant) => resolve(grant.workspacePath) === resolve(project.cwd!));
  if (eligible.length !== 1)
    throw new Error(
      eligible.length
        ? 'The Bot has multiple eligible workspace grants. Set the project cwd to select one.'
        : project.cwd
          ? 'The Bot needs a workspace grant for the project cwd.'
          : 'The Bot has no active workspace grant.',
    );
  const result = await deps.runtime.runDirectBotTool(
    bot.slug,
    'create_assignment',
    {
      title: task.title,
      description: task.brief,
      ...(project.instructions ? { instructions: task.brief + '\n\n' + project.instructions } : {}),
      worker_id: worker,
      grant_id: eligible[0]!.id,
      key: 'project-task:' + task.id,
    },
    AbortSignal.timeout(30_000),
    undefined,
    undefined,
    human,
  );
  const outcome = asObject(
    typeof result.result === 'string' ? JSON.parse(result.result) : result.result,
  );
  if (outcome.outcome !== 'created' || typeof outcome.sessionId !== 'string')
    throw new Error(
      typeof outcome.message === 'string'
        ? outcome.message
        : 'The Host did not start an Assignment.',
    );
  return outcome.sessionId;
}
