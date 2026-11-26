// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { sharedMemoryActions } from '@botharness/host-client/shared-memory';
import { SharedMemorySettings } from '../src/client/shared-memory-settings.js';
import { WorkerEditor } from '../src/client/worker-editor.js';
import { zhTranslate as t } from '../src/client/locale.js';
import { buttonNamed, dialog, fieldNamed, typeInto } from './primitive-mocks.js';

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const mocks = await import('./primitive-mocks.js');
  return { ...mocks.shellPrimitives(), ...mocks.dialogPrimitives() };
});
vi.mock('../src/client/ds/select.js', () => ({
  Select: ({ label }: { label: string }) => <select aria-label={label} />,
}));

function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const target = document.createElement('div');
  document.body.append(target);
  const root = createRoot(target);
  return {
    target,
    root,
    close() {
      act(() => root.unmount());
      target.remove();
      vi.unstubAllGlobals();
    },
  };
}

it('renders sharing status and uses the same Host operations for enable, refresh and disable', async () => {
  const ui = mount();
  let current = '/host/shared';
  const call = vi.fn(async (_method: string, { action, dir }: { action: string; dir?: string }) => {
    if (action === 'set') current = dir!;
    if (action === 'clear') current = '';
    return {
      sharedMemoryRoot: current,
      mounts: current
        ? [{ slug: 'reviewer', path: '/host/bots/reviewer/shared', mode: 'copy', readOnly: true }]
        : [],
    };
  });
  try {
    await act(async () =>
      ui.root.render(
        <SharedMemorySettings
          t={t}
          actions={{
            sharedMemory: sharedMemoryActions({ call }),
            pickWorkspaceFolder: async () => '/host/new-shared',
          }}
        />,
      ),
    );
    expect(call).toHaveBeenCalledWith('sharedMemory', { action: 'status' });
    expect(ui.target.textContent).toContain('reviewer · copy · 只读');
    expect(fieldNamed(t('sharedMemory.directory')).value).toBe('/host/shared');
    await act(async () => buttonNamed(t('sharedMemory.choose')).click());
    await act(async () => buttonNamed(t('sharedMemory.enable')).click());
    expect(call).toHaveBeenLastCalledWith('sharedMemory', {
      action: 'set',
      dir: '/host/new-shared',
    });
    await act(async () => buttonNamed(t('sharedMemory.refresh')).click());
    expect(call).toHaveBeenLastCalledWith('sharedMemory', {
      action: 'set',
      dir: '/host/new-shared',
    });
    await act(async () => buttonNamed(t('sharedMemory.clear')).click());
    expect(call).toHaveBeenLastCalledWith('sharedMemory', { action: 'clear' });
    expect(fieldNamed(t('sharedMemory.directory')).value).toBe('');
  } finally {
    ui.close();
  }
});

it('renders the worker form, rejects invalid and duplicate IDs, and saves a valid worker', async () => {
  const ui = mount();
  const onSave = vi.fn(async () => {});
  try {
    await act(async () =>
      ui.root.render(
        <WorkerEditor
          slug="ada"
          original={undefined}
          usedIds={['taken']}
          actions={{ modelCatalog: vi.fn().mockResolvedValue({ models: [] }) }}
          t={t}
          onClose={vi.fn()}
          onSave={onSave}
        />,
      ),
    );
    expect(dialog().querySelector('select')?.getAttribute('aria-label')).toBe(
      t('workerEdit.model'),
    );
    expect(dialog().textContent).toContain(t('workerEdit.skills'));
    await typeInto(fieldNamed(t('workerEdit.name')), 'Reviewer');
    await act(async () => {
      const field = dialog().querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        'Check the release',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const id = fieldNamed(t('workerEdit.id'));
    const save = buttonNamed(t('workerEdit.save'));
    await typeInto(id, '../bad');
    expect(save.disabled).toBe(true);
    await typeInto(id, 'taken');
    expect(save.disabled).toBe(true);
    await typeInto(id, 'reviewer');
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(onSave).toHaveBeenCalledWith({
      id: 'reviewer',
      name: 'Reviewer',
      persona: 'Check the release',
      model: 'default',
    });
  } finally {
    ui.close();
  }
});
