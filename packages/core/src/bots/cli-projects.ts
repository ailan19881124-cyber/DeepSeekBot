import { readFileSync } from 'node:fs';
import { CliFailure, usageError } from '../features/personabots/cli-errors.js';
import { resolveHome } from '../features/personabots/cli-offline.js';
import type { BotCreateCliIo, CreateValues } from '../features/personabots/cli-types.js';
import { runOfflineProjectOperation } from '../projects/offline.js';
import { connectLiveHost } from './cli-live-host.js';

export const PROJECT_COMMANDS = new Set([
  'project-create',
  'project-list',
  'project-show',
  'task-create',
  'task-list',
  'task-update',
]);

export async function runProjectCli(
  command: string,
  rest: readonly string[],
  values: CreateValues,
  io: BotCreateCliIo,
) {
  const [id] = rest;
  const needsId = command === 'project-show' || command === 'task-update';
  if (rest.length !== Number(needsId))
    throw usageError(needsId ? 'Expected one id.' : 'Unexpected positional arguments.');
  if (values.as !== undefined) throw usageError('Projects require the Host owner.');

  let input: unknown;
  if (command === 'project-create')
    input = {
      name: values.name,
      cwd: values.cwd,
      ...(values['instructions-file'] === undefined
        ? {}
        : { instructions: readFileSync(values['instructions-file'], 'utf8') }),
    };
  if (command === 'project-show') input = id;
  if (command === 'task-create')
    input = {
      projectId: values.project,
      title: values.title,
      brief: values.brief,
      workerId: values.worker,
    };
  if (command === 'task-list') input = { projectId: values.project, state: values.state };
  if (command === 'task-update') {
    const revision = values['expected-revision'];
    if (revision !== undefined && !/^[1-9][0-9]*$/u.test(revision))
      throw usageError('--expected-revision must be a positive integer.');
    input = {
      id,
      state: values.state,
      expectedRevision: revision === undefined ? undefined : Number(revision),
    };
  }

  if (values.host !== undefined || io.env['DEEPSEEKBOT_HOST'] !== undefined) {
    if (values.home !== undefined)
      throw usageError('Do not combine --home and an online Host target.');
    const { rpc } = await connectLiveHost(values, io, AbortSignal.timeout(30_000));
    return rpc('projectOperation', { action: command, ...(input === undefined ? {} : { input }) });
  }
  if (values['token-file'] !== undefined)
    throw usageError('--token-file requires an online Host target.');
  const result = runOfflineProjectOperation(resolveHome(values, io), command, input);
  if (!result.ok) throw new CliFailure(result.error.code, result.error.message, 1);
  return result.value;
}
