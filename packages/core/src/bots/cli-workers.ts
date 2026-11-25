import { readFileSync } from 'node:fs';
import { connectLiveHost } from './cli-live-host.js';
import { parseWorkerFile } from '../memory/workers.js';
import { CliFailure, usageError } from '../features/personabots/cli-errors.js';
import { openRegistry, resolveHome } from '../features/personabots/cli-offline.js';
import type { BotCreateCliIo, CreateValues } from '../features/personabots/cli-types.js';
import { runWorkerOperation } from '../features/personabots/worker-operation.js';

export async function runWorkerCli(
  command: string,
  rest: readonly string[],
  values: CreateValues,
  io: BotCreateCliIo,
) {
  const { bot, file, id } = values;
  const action = command.slice('worker-'.length);
  if (
    rest.length ||
    !bot ||
    (action === 'set' ? !file || id !== undefined : file !== undefined) ||
    (action === 'remove' ? !id : id !== undefined)
  )
    throw usageError(
      'Use worker-list --bot <id>, worker-set --bot <id> --file <path>, or worker-remove --bot <id> --id <worker-id>.',
    );
  let value: unknown = id;
  if (file !== undefined) {
    try {
      value = parseWorkerFile(file, readFileSync(file, 'utf8'));
    } catch (error) {
      throw usageError(error instanceof Error ? error.message : String(error));
    }
  }
  if (values.host !== undefined || io.env['DEEPSEEKBOT_HOST'] !== undefined) {
    if (values.home !== undefined)
      throw usageError('Do not combine --home and an online Host target.');
    const { rpc } = await connectLiveHost(values, io, AbortSignal.timeout(30_000));
    return rpc('workerTemplates', value === undefined ? { action, bot } : { action, bot, value });
  }
  if (values.as !== undefined || values['token-file'] !== undefined)
    throw usageError('--as and --token-file require an online Host target.');
  const { registry, owner } = openRegistry(resolveHome(values, io));
  try {
    const result = runWorkerOperation(registry, action, bot, value);
    if (!result.ok) throw new CliFailure(result.error.code, result.error.message, 1);
    return result.value;
  } finally {
    owner.close();
  }
}
