// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { loadWorkers, startAssignment } from '@botharness/host-client/workers';
import { WorkCreateDialog, WorkerList } from '../src/client/worker-chooser.js';
import { zhTranslate as t } from '../src/client/locale.js';
import { buttonNamed, dialog, fieldNamed, typeInto } from './primitive-mocks.js';

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const mocks = await import('./primitive-mocks.js');
  return { ...mocks.shellPrimitives(), ...mocks.dialogPrimitives() };
});
vi.mock('../src/client/ds/select.js', () => ({
  Select: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange(value: string): void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

it('loads existing worker templates, shows their details, and submits the selected worker', async () => {
  const worker = {
    id: 'review',
    name: 'Reviewer',
    persona: 'Review carefully',
    model: { provider: 'deepseek', model: 'v4' },
  };
  const call = vi.fn(async (method: string) =>
    method === 'workerTemplates' ? { workers: [worker] } : { result: '{"outcome":"created"}' },
  );
  const workers = await loadWorkers({ call }, 'ada');
  expect(call).toHaveBeenCalledWith('workerTemplates', { action: 'list', bot: 'ada' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const target = document.createElement('div');
  document.body.append(target);
  const root = createRoot(target);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(
        <>
          <WorkerList workers={workers} t={t} />
          <WorkCreateDialog
            title={t('projects.newAssignment')}
            t={t}
            workers={workers}
            onClose={close}
            onCreate={(draft) => startAssignment({ call }, 'ada', draft)}
          />
        </>,
      ),
    );
    expect(target.textContent).toContain('deepseek / v4');
    expect(target.textContent).toContain('Review carefully');
    const select = dialog().querySelector('select')!;
    expect([...select.options].map((option) => option.text)).toEqual(['默认', 'Reviewer']);
    await typeInto(fieldNamed('标题'), 'Run checks');
    await act(async () => {
      const field = dialog().querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        'Inspect changes',
      );
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      select.value = 'review';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => buttonNamed('创建').click());
    expect(call).toHaveBeenCalledWith('botToolRun', {
      slug: 'ada',
      tool: 'create_assignment',
      args: { title: 'Run checks', description: 'Inspect changes', worker_id: 'review' },
    });
    expect(close).toHaveBeenCalled();
    await startAssignment({ call }, 'ada', { title: 'Default', brief: 'Inspect' });
    expect(call).toHaveBeenLastCalledWith('botToolRun', {
      slug: 'ada',
      tool: 'create_assignment',
      args: { title: 'Default', description: 'Inspect' },
    });
  } finally {
    act(() => root.unmount());
    target.remove();
    vi.unstubAllGlobals();
  }
});
