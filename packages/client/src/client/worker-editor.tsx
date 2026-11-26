import { useState } from 'react';
import type { WorkerTemplate } from '@botharness/host-protocol/workers';
import { WORKER_ID_PATTERN } from '@botharness/host-protocol/workers';
import type { BridgeActions } from './actions.js';
import { Button } from './ds/button.js';
import { TextAreaField, TextField } from './ds/field.js';
import { FormDialog } from './ds/form-dialog.js';
import { Select } from './ds/select.js';
import type { BotHarnessTranslate } from './locale.js';
import { useMountedResource } from './mounted-resource.js';
import { WorkerList } from './worker-chooser.js';

const modelKey = (model: WorkerTemplate['model']) =>
  model === 'default' ? '' : JSON.stringify([model.provider, model.model]);

export function WorkersManager({
  slug,
  workers,
  actions,
  refresh,
  t,
}: {
  slug: string;
  workers: WorkerTemplate[];
  actions: BridgeActions;
  refresh(): void;
  t: BotHarnessTranslate;
}) {
  const [editing, setEditing] = useState<WorkerTemplate | 'new'>();
  const [deleting, setDeleting] = useState<WorkerTemplate>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const closeDelete = () => {
    if (!busy) {
      setDeleting(undefined);
      setError(undefined);
    }
  };
  return (
    <>
      <WorkerList
        workers={workers}
        t={t}
        actionsFor={(worker) => (
          <>
            {actions.saveWorker ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(worker)}>
                {t('workerEdit.edit')}
              </Button>
            ) : null}
            {actions.removeWorker ? (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(worker)}>
                {t('workerEdit.delete')}
              </Button>
            ) : null}
          </>
        )}
      />
      {actions.saveWorker ? (
        <Button variant="outline" onClick={() => setEditing('new')}>
          {t('workerEdit.new')}
        </Button>
      ) : null}
      {editing && actions.saveWorker ? (
        <WorkerEditor
          slug={slug}
          original={editing === 'new' ? undefined : editing}
          usedIds={workers.map(({ id }) => id)}
          actions={actions}
          t={t}
          onClose={() => setEditing(undefined)}
          onSave={async (worker) => {
            await actions.saveWorker!(slug, worker);
            refresh();
          }}
        />
      ) : null}
      {deleting && actions.removeWorker ? (
        <FormDialog
          title={t('workerEdit.delete')}
          labels={{ close: t('projects.close'), cancel: t('projects.close') }}
          submitLabel={t('workerEdit.delete')}
          danger
          busy={busy}
          error={error}
          onCancel={closeDelete}
          onClose={closeDelete}
          onSubmit={() => {
            setBusy(true);
            void actions.removeWorker!(slug, deleting.id)
              .then(
                () => {
                  refresh();
                  setDeleting(undefined);
                  setError(undefined);
                },
                (cause: unknown) => setError(String(cause)),
              )
              .finally(() => setBusy(false));
          }}
        >
          <p>{deleting.name}</p>
        </FormDialog>
      ) : null}
    </>
  );
}

export function WorkerEditor({
  slug,
  original,
  usedIds,
  actions,
  t,
  onClose,
  onSave,
}: {
  slug: string;
  original: WorkerTemplate | undefined;
  usedIds: readonly string[];
  actions: Pick<BridgeActions, 'modelCatalog' | 'botSkills'>;
  t: BotHarnessTranslate;
  onClose(): void;
  onSave(worker: WorkerTemplate): Promise<void>;
}) {
  const [id, setId] = useState(original?.id ?? '');
  const [name, setName] = useState(original?.name ?? '');
  const [persona, setPersona] = useState(original?.persona ?? '');
  const [model, setModel] = useState(modelKey(original?.model ?? 'default'));
  const [skills, setSkills] = useState(original?.skills ?? []);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [models, setModels] = useState<Array<{ value: string; label: string }>>([]);
  const [error, setError] = useState<string>();
  const [catalogError, setCatalogError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = useMountedResource<HTMLDivElement>(() => {
    let active = true;
    const fail = (cause: unknown) => {
      if (active) setCatalogError(String(cause));
    };
    void actions.modelCatalog().then(({ models }) => {
      if (active)
        setModels(
          models.map(({ provider, model, modelName }) => ({
            value: modelKey({ provider, model }),
            label: provider + ' / ' + modelName,
          })),
        );
    }, fail);
    void actions.botSkills?.(slug).then((items) => {
      if (active) setAvailableSkills(items.map(({ name }) => name));
    }, fail);
    return () => {
      active = false;
    };
  }, [actions.modelCatalog, actions.botSkills, slug]);
  const validId = WORKER_ID_PATTERN.test(id) && (!!original || !usedIds.includes(id));
  const choices = [{ value: '', label: t('projects.defaultWorker') }, ...models];
  if (
    original?.model &&
    original.model !== 'default' &&
    !choices.some(({ value }) => value === modelKey(original.model))
  )
    choices.push({
      value: modelKey(original.model),
      label: original.model.provider + ' / ' + original.model.model,
    });
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <FormDialog
      title={t(original ? 'workerEdit.edit' : 'workerEdit.new')}
      labels={{ close: t('projects.close'), cancel: t('projects.close') }}
      submitLabel={t('workerEdit.save')}
      submitDisabled={!validId || !name.trim() || !persona.trim()}
      busy={busy}
      error={error ?? catalogError}
      onClose={close}
      onCancel={close}
      onSubmit={() => {
        const [provider, modelId] = model ? (JSON.parse(model) as [string, string]) : ['', ''];
        setBusy(true);
        setError(undefined);
        void onSave({
          id,
          name: name.trim(),
          persona: persona.trim(),
          model: model ? { provider, model: modelId } : 'default',
          ...(skills.length ? { skills } : {}),
        })
          .then(onClose, (cause: unknown) => setError(String(cause)))
          .finally(() => setBusy(false));
      }}
    >
      <div ref={load}>
        <TextField
          label={t('workerEdit.id')}
          value={id}
          onChange={setId}
          maxLength={64}
          disabled={!!original || busy}
          error={id && !validId ? t('workerEdit.invalidId') : undefined}
        />
        <TextField
          label={t('workerEdit.name')}
          value={name}
          onChange={setName}
          maxLength={120}
          disabled={busy}
        />
        <TextAreaField
          label={t('workerEdit.persona')}
          value={persona}
          onChange={setPersona}
          maxLength={12000}
          disabled={busy}
        />
        <Select
          label={t('workerEdit.model')}
          value={model}
          options={choices}
          onChange={setModel}
          disabled={busy}
        />
        <fieldset>
          <legend>{t('workerEdit.skills')}</legend>
          {[...new Set([...availableSkills, ...skills])].map((skill) => (
            <Button
              key={skill}
              type="button"
              variant={skills.includes(skill) ? 'outline' : 'ghost'}
              aria-pressed={skills.includes(skill)}
              disabled={busy}
              onClick={() =>
                setSkills((current) =>
                  current.includes(skill)
                    ? current.filter((item) => item !== skill)
                    : [...current, skill],
                )
              }
            >
              {skill}
            </Button>
          ))}
        </fieldset>
      </div>
    </FormDialog>
  );
}
