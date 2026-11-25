import { invalidInput, type BridgeResult } from '../../bridge/method-utils.js';
import type { PersonaBotRegistry } from '../../bots/registry.js';
import { listWorkers, removeWorker, setWorker, type WorkerTemplate } from '../../memory/workers.js';

type WorkerResult =
  | { workers: WorkerTemplate[] }
  | { worker: WorkerTemplate }
  | { removed: boolean };

export function runWorkerOperation(
  registry: PersonaBotRegistry,
  action: unknown,
  bot: unknown,
  value: unknown,
): BridgeResult<WorkerResult> {
  if (typeof bot !== 'string' || !registry.get(bot)) return invalidInput('Unknown Bot.');
  const root = registry.memoryDirFor(bot);
  if (!root) return invalidInput('Bot Memory is unavailable.');
  try {
    if (action === 'list' && value === undefined)
      return { ok: true, value: { workers: listWorkers(root) } };
    if (action === 'set') return { ok: true, value: { worker: setWorker(root, value) } };
    if (action === 'remove' && typeof value === 'string')
      return { ok: true, value: { removed: removeWorker(root, value) } };
    return invalidInput('Expected worker list, set, or remove.');
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : String(error));
  }
}
