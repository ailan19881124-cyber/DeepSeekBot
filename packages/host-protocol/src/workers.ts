export const WORKER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;

export interface WorkerTemplate {
  id: string;
  name: string;
  persona: string;
  model: 'default' | { provider: string; model: string };
  skills?: string[] | undefined;
}
