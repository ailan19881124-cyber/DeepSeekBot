export interface WorkerTemplate {
  id: string;
  name: string;
  persona: string;
  model: 'default' | { provider: string; model: string };
  skills?: string[] | undefined;
}
