import { answerRecord, record, text, HostAnswerInvalid, type HostCall } from './host-answer';

export interface SharedMount {
  slug: string;
  path: string;
  mode: 'symlink' | 'copy' | 'unmounted';
  readOnly: boolean | null;
}

function isMount(value: unknown): value is SharedMount {
  const row = record(value);
  return (
    !!row &&
    text(row.slug) &&
    text(row.path) &&
    ['symlink', 'copy', 'unmounted'].some((mode) => mode === row.mode) &&
    (typeof row.readOnly === 'boolean' || row.readOnly === null)
  );
}

export function sharedMemoryActions(host: HostCall) {
  const call = async (action: string, dir?: string) => {
    const result = answerRecord(
      await host.call('sharedMemory', { action, ...(dir === undefined ? {} : { dir }) }),
      'sharedMemory',
    );
    if (
      !text(result.sharedMemoryRoot) ||
      !Array.isArray(result.mounts) ||
      !result.mounts.every(isMount)
    )
      throw new HostAnswerInvalid('Invalid shared memory status.');
    return { sharedMemoryRoot: result.sharedMemoryRoot, mounts: result.mounts };
  };
  return {
    status: () => call('status'),
    set: (dir: string) => call('set', dir),
    clear: () => call('clear'),
  };
}
export type SharedMemoryActions = ReturnType<typeof sharedMemoryActions>;
