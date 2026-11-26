import { attachOperationalModule } from '../database/owner.js';
import { openRegistry } from '../features/personabots/cli-offline.js';
import { launchCreatedTask, runProjectOperation } from './operations.js';
import { createProjectStore } from './store.js';

export async function runOfflineProjectOperation(home: string, action: string, input: unknown) {
  const { owner } = openRegistry(home);
  try {
    const projects = createProjectStore(attachOperationalModule(owner, 'projects'));
    const result = runProjectOperation(projects, action, input);
    return action === 'task-create'
      ? await launchCreatedTask(projects, result, async () => {
          throw new Error(
            'Assignment execution requires a running Host. Use --host to launch a worker.',
          );
        })
      : result;
  } finally {
    owner.close();
  }
}
