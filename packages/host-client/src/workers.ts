import type { WorkerTemplate } from '@botharness/host-protocol/workers';
import {
  answerRecord,
  HostAnswerInvalid,
  record,
  strings,
  text,
  type HostCall,
} from './host-answer';

function isWorker(value: unknown): value is WorkerTemplate {
  const worker = record(value);
  if (!worker || !text(worker.id) || !text(worker.name) || !text(worker.persona)) return false;
  const model = record(worker.model);
  return (
    (worker.model === 'default' ||
      (model !== undefined && text(model.provider) && text(model.model))) &&
    (worker.skills === undefined || strings(worker.skills))
  );
}

export async function loadWorkers(host: HostCall, slug: string): Promise<WorkerTemplate[]> {
  const result = answerRecord(
    await host.call('workerTemplates', { action: 'list', bot: slug }),
    'workerTemplates',
  );
  if (!Array.isArray(result.workers) || !result.workers.every(isWorker))
    throw new HostAnswerInvalid('workerTemplates returned invalid workers.');
  return result.workers;
}

export interface AssignmentDraft {
  title: string;
  brief: string;
  workerId?: string;
  grantId?: string;
}

export async function startAssignment(
  host: HostCall,
  slug: string,
  draft: AssignmentDraft,
): Promise<void> {
  const { result } = answerRecord(
    await host.call('botToolRun', {
      slug,
      tool: 'create_assignment',
      args: {
        title: draft.title,
        description: draft.brief,
        ...(draft.grantId ? { grant_id: draft.grantId } : {}),
        ...(draft.workerId ? { worker_id: draft.workerId } : {}),
      },
    }),
    'botToolRun',
  );
  const outcome = record(typeof result === 'string' ? JSON.parse(result) : result);
  if (outcome?.outcome !== 'created')
    throw new Error(text(outcome?.message) ? outcome.message : 'Assignment creation failed.');
}
