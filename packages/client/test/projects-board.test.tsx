// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { projectActions } from '@botharness/host-client/projects';
import { ProjectsBoard } from '../src/client/projects-board.js';
import { zhTranslate as t } from '../src/client/locale.js';
import { buttonNamed, dialog } from './primitive-mocks.js';

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const mocks = await import('./primitive-mocks.js');
  return { ...mocks.shellPrimitives(), ...mocks.dialogPrimitives() };
});
vi.mock('../src/client/ds/select.js', async () => {
  const { createElement } = await import('react');
  return {
    Select: ({
      label,
      options,
    }: {
      label: string;
      options: Array<{ value: string; label: string }>;
    }) =>
      createElement(
        'select',
        { 'aria-label': label },
        options.map((option) =>
          createElement('option', { key: option.value, value: option.value }, option.label),
        ),
      ),
  };
});

it('renders the project board and loads workers into the task dialog', async () => {
  const at = '2026-01-01T00:00:00.000Z';
  const project = {
    id: 'p',
    name: 'Release',
    instructions: 'Release notes',
    createdAt: at,
    cwd: null,
    archivedAt: null,
  };
  const task = {
    id: 't',
    projectId: 'p',
    title: 'Check docs',
    brief: 'Review',
    state: 'todo',
    assigneeWorkerId: null,
    channelId: null,
    createdAt: at,
    updatedAt: at,
    revision: 1,
  };
  const call = vi.fn(async (_method: string, args?: Record<string, unknown>) => {
    if (args?.action === 'project-list')
      return { projects: [{ ...project, taskCount: 1, updatedAt: at }] };
    if (args?.action === 'project-show') return { project };
    if (args?.action === 'task-update') return { task: { ...task, state: 'doing', revision: 2 } };
    return { tasks: [task] };
  });
  const workers = vi.fn(async () => [
    { id: 'review', name: 'Reviewer', persona: 'Review', model: 'default' as const },
  ]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const target = document.createElement('div');
  document.body.append(target);
  const root = createRoot(target);
  try {
    await act(async () =>
      root.render(
        <ProjectsBoard
          actions={projectActions({ call })}
          loadWorkers={workers}
          bots={[{ id: 'ada', name: 'Ada' }]}
          t={t}
          onClose={() => {}}
        />,
      ),
    );
    expect(dialog().textContent).toContain('1 个任务');
    await act(async () => buttonNamed('Release').click());
    expect(dialog().textContent).toContain('Release notes');
    expect([...dialog().querySelectorAll('section h2')].map((node) => node.textContent)).toEqual([
      '待办',
      '进行中',
      '待审核',
      '已完成',
      '失败',
    ]);
    await act(async () => buttonNamed('移至进行中').click());
    expect(call).toHaveBeenCalledWith('projectOperation', {
      action: 'task-update',
      input: { id: 't', state: 'doing', expectedRevision: 1 },
    });
    await act(async () => buttonNamed('新建任务').click());
    expect(workers).toHaveBeenCalledWith('ada');
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="执行者"]')!;
    expect([...select.options].map((option) => option.text)).toEqual(['默认', 'Reviewer']);
  } finally {
    act(() => root.unmount());
    target.remove();
    vi.unstubAllGlobals();
  }
});
