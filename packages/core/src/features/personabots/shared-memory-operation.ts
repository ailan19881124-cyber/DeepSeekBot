import { invalidInput, type BridgeResult } from '../../bridge/method-utils.js';
import type { PersonaBotRegistry } from '../../bots/registry.js';
import type { createSharedMemory } from '../../memory/shared-memory.js';

export function runSharedMemoryOperation(
  sharedMemory: ReturnType<typeof createSharedMemory>,
  registry: PersonaBotRegistry,
  action: unknown,
  dir: unknown,
): BridgeResult<ReturnType<typeof sharedMemory.status>> {
  try {
    if (action === 'status' && dir === undefined)
      return { ok: true, value: sharedMemory.status(registry) };
    if (action === 'clear' && dir === undefined)
      return { ok: true, value: sharedMemory.clear(registry) };
    if (action === 'set' && typeof dir === 'string')
      return { ok: true, value: sharedMemory.set(registry, dir) };
    return invalidInput('Use shared-memory status, set --dir <absolute path>, or clear.');
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'shared-memory-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
