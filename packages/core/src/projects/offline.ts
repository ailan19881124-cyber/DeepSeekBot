import { attachOperationalModule } from '../database/owner.js';
import { openRegistry } from '../features/personabots/cli-offline.js';
import { runProjectOperation } from './operations.js';
import { createProjectStore } from './store.js';

export function runOfflineProjectOperation(home: string, action: string, input: unknown) {
  const { owner } = openRegistry(home);
  try {
    return runProjectOperation(
      createProjectStore(attachOperationalModule(owner, 'projects')),
      action,
      input,
    );
  } finally {
    owner.close();
  }
}
