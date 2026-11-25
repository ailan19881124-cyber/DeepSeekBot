import { join } from 'node:path';
import { connectLiveHost } from './cli-live-host.js';
import { createSharedMemory } from '../memory/shared-memory.js';
import { CliFailure, usageError } from '../features/personabots/cli-errors.js';
import { openRegistry, resolveHome } from '../features/personabots/cli-offline.js';
import type { BotCreateCliIo, CreateValues } from '../features/personabots/cli-types.js';
import { runSharedMemoryOperation } from '../features/personabots/shared-memory-operation.js';

export async function runSharedMemoryCli(
  rest: readonly string[],
  values: CreateValues,
  io: BotCreateCliIo,
) {
  const [action] = rest;
  const dir = values.dir;
  if (
    rest.length !== 1 ||
    (action === 'set' ? !dir : !['status', 'clear'].includes(action ?? '') || dir !== undefined)
  )
    throw usageError('Use shared-memory status, set --dir <absolute path>, or clear.');
  if (values.host !== undefined || io.env['DEEPSEEKBOT_HOST'] !== undefined) {
    if (values.home !== undefined)
      throw usageError('Do not combine --home and an online Host target.');
    const { rpc } = await connectLiveHost(values, io, AbortSignal.timeout(30_000));
    return rpc('sharedMemory', dir === undefined ? { action } : { action, dir });
  }
  if (values['token-file'] !== undefined)
    throw usageError('--token-file requires an online Host target.');
  const home = resolveHome(values, io);
  const { registry, owner } = openRegistry(home, true, true);
  try {
    const result = runSharedMemoryOperation(
      createSharedMemory(join(home, 'botharness')),
      registry,
      action,
      dir,
    );
    if (!result.ok) throw new CliFailure(result.error.code, result.error.message, 1);
    return result.value;
  } finally {
    owner.close();
  }
}
