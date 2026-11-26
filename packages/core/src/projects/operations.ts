import type { BridgeResult } from '../bridge/method-utils.js';
import { invalidInput } from '../bridge/method-utils.js';
import { ProjectError, type ProjectStore } from './store.js';

export function runProjectOperation(
  store: ProjectStore,
  action: unknown,
  input: unknown,
): BridgeResult<unknown> {
  try {
    switch (action) {
      case 'project-create':
        return { ok: true, value: { project: store.createProject(input) } };
      case 'project-list':
        return { ok: true, value: { projects: store.listProjects() } };
      case 'project-show':
        return { ok: true, value: { project: store.showProject(input) } };
      case 'task-create':
        return { ok: true, value: { task: store.createTask(input) } };
      case 'task-list':
        return { ok: true, value: { tasks: store.listTasks(input) } };
      case 'task-update':
        return { ok: true, value: { task: store.updateTask(input) } };
      default:
        return invalidInput('Unknown project or task operation.');
    }
  } catch (error) {
    if (error instanceof ProjectError)
      return { ok: false, error: { code: error.code, message: error.message } };
    if (error instanceof Error && error.name === 'ZodError') return invalidInput(error.message);
    throw error;
  }
}
