import { useState } from 'react';
import type { WorkerTemplate } from '@botharness/host-protocol/workers';
import type { AssignmentDraft } from '@botharness/host-client/workers';
import { FormDialog } from './ds/form-dialog.js';
import { TextAreaField, TextField } from './ds/field.js';
import { useMountedResource } from './mounted-resource.js';
import { Select } from './ds/select.js';
import type { BotHarnessTranslate } from './locale.js';

export type ReadWorkers = (slug: string) => Promise<WorkerTemplate[]>;

export function useWorkers(load: ReadWorkers | undefined, slug: string | undefined) {
  const [read, setRead] = useState<{ slug: string; workers?: WorkerTemplate[]; error?: string }>();
  const ref = useMountedResource<HTMLDivElement>(() => {
    if (!load || !slug) return;
    let active = true;
    void load(slug).then(
      (workers) => {
        if (active) setRead({ slug, workers });
      },
      (error: unknown) => {
        if (active) setRead({ slug, error: String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [load, slug]);
  return { ref, read: read?.slug === slug ? read : undefined };
}

export function workerOptions(workers: readonly WorkerTemplate[], t: BotHarnessTranslate) {
  return [
    { value: '', label: t('projects.defaultWorker') },
    ...workers.map(({ id, name }) => ({ value: id, label: name })),
  ];
}

export function WorkerList({
  workers,
  t,
}: {
  workers: readonly WorkerTemplate[];
  t: BotHarnessTranslate;
}) {
  return workers.length ? (
    <ul>
      {workers.map((worker) => (
        <li key={worker.id}>
          <strong>{worker.name}</strong>
          <div>
            {worker.model === 'default'
              ? t('projects.defaultWorker')
              : worker.model.provider + ' / ' + worker.model.model}
          </div>
          <div>
            {[...worker.persona].slice(0, 160).join('')}
            {[...worker.persona].length > 160 ? '…' : ''}
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <div>{t('projects.noWorkers')}</div>
  );
}

export function WorkCreateDialog({
  title,
  t,
  workers,
  workerError,
  grants,
  onClose,
  onCreate,
}: {
  title: string;
  t: BotHarnessTranslate;
  workers: readonly WorkerTemplate[];
  workerError?: string | undefined;
  grants?: readonly { value: string; label: string }[] | undefined;
  onClose(): void;
  onCreate(draft: AssignmentDraft): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [worker, setWorker] = useState('');
  const [grant, setGrant] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onCreate({
        title: name.trim(),
        brief: brief.trim(),
        ...(worker && workers.some(({ id }) => id === worker) ? { workerId: worker } : {}),
        ...(grant ? { grantId: grant } : {}),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      title={title}
      labels={{ close: t('projects.close'), cancel: t('projects.close') }}
      submitLabel={t('projects.create')}
      submitDisabled={
        !name.trim() || !brief.trim() || (grants !== undefined && grants.length > 1 && !grant)
      }
      busy={busy}
      error={error ?? workerError}
      onClose={onClose}
      onCancel={onClose}
      onSubmit={() => {
        void submit();
      }}
    >
      <TextField
        label={t('projects.title')}
        value={name}
        onChange={setName}
        initialFocus
        maxLength={120}
      />
      <TextAreaField label={t('projects.brief')} value={brief} onChange={setBrief} rows={4} />
      {grants && grants.length > 1 ? (
        <Select
          label={t('projects.workspace')}
          value={grant}
          options={[{ value: '', label: t('projects.selectWorkspace') }, ...grants]}
          onChange={setGrant}
        />
      ) : null}
      <Select
        label={t('projects.worker')}
        value={worker}
        options={workerOptions(workers, t)}
        onChange={setWorker}
        disabled={busy}
      />
    </FormDialog>
  );
}
