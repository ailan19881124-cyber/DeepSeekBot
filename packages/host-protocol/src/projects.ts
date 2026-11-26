export const TASK_STATES = ['todo', 'doing', 'review', 'done', 'failed'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  todo: ['doing'],
  doing: ['review', 'failed'],
  review: ['done', 'failed'],
  done: [],
  failed: [],
};

export interface Project {
  id: string;
  name: string;
  instructions: string;
  cwd: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectSummary extends Project {
  taskCount: number;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  brief: string;
  state: TaskState;
  assigneeWorkerId: string | null;
  channelId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
