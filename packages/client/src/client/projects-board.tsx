import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import type { ProjectActions } from '@botharness/host-client/projects';
import {
  TASK_STATES,
  TASK_TRANSITIONS,
  type Project,
  type ProjectSummary,
  type ProjectTask,
  type TaskState,
} from '@botharness/host-protocol/projects';
import { Button } from './ds/button.js';
import { FormDialog } from './ds/form-dialog.js';
import { PanelDialog } from './ds/panel-dialog.js';
import { TextAreaField, TextField } from './ds/field.js';
import { ink, layer, style } from './ds/tobs.stylex.js';
import { space } from './ds/tokens.stylex.js';
import { useMountedResource } from './mounted-resource.js';
import type { BotHarnessTranslate } from './locale.js';
import { type ReadWorkers, useWorkers, WorkCreateDialog } from './worker-chooser.js';

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: space.x3 },
  row: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: space.x3 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(min-content, 1fr))',
    gap: space.x3,
    overflowX: 'auto',
  },
  column: {
    backgroundColor: layer.well,
    borderRadius: style.radiusControl,
    padding: space.x3,
    minWidth: 0,
  },
  card: {
    backgroundColor: layer.raised,
    borderRadius: style.radiusControl,
    padding: space.x3,
    overflowWrap: 'anywhere',
  },
  heading: { margin: 0, fontSize: style.textUiSize },
  meta: { color: ink.secondary, fontSize: style.textUiSize },
  prose: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 },
});

type BotOption = { id: string; name: string };

export function ProjectsBoard({
  actions,
  loadWorkers,
  bots,
  t,
  onClose,
}: {
  actions: ProjectActions;
  loadWorkers: ReadWorkers | undefined;
  bots: readonly BotOption[];
  t: BotHarnessTranslate;
  onClose(): void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<{ project: Project; tasks: ProjectTask[] }>();
  const [workerBot, setWorkerBot] = useState('');
  const [creating, setCreating] = useState<'project' | 'task'>();
  const [error, setError] = useState<string>();
  const [moving, setMoving] = useState<string>();

  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  const listRef = useMountedResource<HTMLDivElement>(() => {
    let active = true;
    void actions.list().then(
      (result) => {
        if (active) setProjects(result);
      },
      (cause: unknown) => {
        if (active) report(cause);
      },
    );
    return () => {
      active = false;
    };
  }, [actions]);
  const detailRef = useMountedResource<HTMLDivElement>(() => {
    if (!selected) return;
    let active = true;
    void Promise.all([actions.show(selected), actions.tasks(selected)]).then(
      ([project, tasks]) => {
        if (active) setDetail({ project, tasks });
      },
      (cause: unknown) => {
        if (active) report(cause);
      },
    );
    return () => {
      active = false;
    };
  }, [actions, selected]);
  const workerSlug = workerBot || bots[0]?.id;
  const { read: workers, ref: workersRef } = useWorkers(
    loadWorkers,
    creating === 'task' ? workerSlug : undefined,
  );
  const open = (id: string | undefined) => {
    setError(undefined);
    setDetail(undefined);
    setSelected(id);
  };
  const move = async (task: ProjectTask, state: TaskState) => {
    setMoving(task.id);
    setError(undefined);
    try {
      const updated = await actions.updateTask(task.id, state, task.revision);
      setDetail((current) =>
        current?.project.id === task.projectId
          ? {
              ...current,
              tasks: current.tasks.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
    } catch (cause) {
      report(cause);
      try {
        const tasks = await actions.tasks(task.projectId);
        setDetail((current) =>
          current?.project.id === task.projectId ? { ...current, tasks } : current,
        );
      } catch {}
    } finally {
      setMoving(undefined);
    }
  };

  return (
    <>
      <PanelDialog
        title={detail?.project.name ?? t('projects.heading')}
        size="wide"
        scroll
        closeLabel={t('projects.close')}
        onClose={onClose}
        actions={
          selected ? (
            <Button variant="ghost" onClick={() => open(undefined)}>
              {t('projects.heading')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setCreating('project')}>
              {t('projects.newProject')}
            </Button>
          )
        }
      >
        {error ? <div role="alert">{error}</div> : null}
        {selected === undefined ? (
          <div ref={listRef} {...stylex.props(styles.stack)}>
            {projects === undefined ? <div role="status">{t('projects.loading')}</div> : null}
            {projects?.length === 0 ? <div>{t('projects.empty')}</div> : null}
            {projects?.map((project) => (
              <div key={project.id} {...stylex.props(styles.row)}>
                <Button variant="ghost" onClick={() => open(project.id)}>
                  {project.name}
                </Button>
                <span {...stylex.props(styles.meta)}>
                  {t('projects.taskCount', { count: project.taskCount })}
                </span>
                <time dateTime={project.updatedAt} {...stylex.props(styles.meta)}>
                  {new Date(project.updatedAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <div ref={detailRef} {...stylex.props(styles.stack)}>
            {detail ? (
              <>
                {detail.project.instructions ? (
                  <p {...stylex.props(styles.prose)}>{detail.project.instructions}</p>
                ) : null}
                <div>
                  <Button
                    variant="primary"
                    disabled={detail.project.archivedAt !== null}
                    onClick={() => setCreating('task')}
                  >
                    {t('projects.newTask')}
                  </Button>
                </div>
                <div {...stylex.props(styles.grid)}>
                  {TASK_STATES.map((state) => (
                    <section key={state} {...stylex.props(styles.column, styles.stack)}>
                      <h2 {...stylex.props(styles.heading)}>{t(`projects.state.${state}`)}</h2>
                      {detail.tasks
                        .filter((task) => task.state === state)
                        .map((task) => (
                          <article key={task.id} {...stylex.props(styles.card, styles.stack)}>
                            <strong>{task.title}</strong>
                            <p {...stylex.props(styles.prose)}>{task.brief}</p>
                            {task.assigneeWorkerId ? (
                              <span {...stylex.props(styles.meta)}>{task.assigneeWorkerId}</span>
                            ) : null}
                            {TASK_TRANSITIONS[state].map((next) => (
                              <Button
                                key={next}
                                variant="outline"
                                size="sm"
                                disabled={moving !== undefined}
                                onClick={() => {
                                  void move(task, next);
                                }}
                              >
                                {t('projects.move', { state: t(`projects.state.${next}`) })}
                              </Button>
                            ))}
                          </article>
                        ))}
                    </section>
                  ))}
                </div>
              </>
            ) : !error ? (
              <div role="status">{t('projects.loading')}</div>
            ) : null}
          </div>
        )}
      </PanelDialog>
      {creating === 'project' ? (
        <ProjectCreateDialog
          t={t}
          onClose={() => setCreating(undefined)}
          onCreate={async (name, instructions) => {
            const result = await actions.create(name, instructions);
            open(result.id);
          }}
        />
      ) : null}
      {creating === 'task' && detail ? (
        <div ref={workersRef}>
          <WorkCreateDialog
            title={t('projects.newTask')}
            t={t}
            workers={workers?.workers ?? []}
            workerError={workers?.error}
            workerScope={
              bots.length > 1 && workerSlug
                ? {
                    value: workerSlug,
                    options: bots.map(({ id, name }) => ({ value: id, label: name })),
                    onChange: setWorkerBot,
                  }
                : undefined
            }
            onClose={() => setCreating(undefined)}
            onCreate={async ({ title, brief, workerId }) => {
              const id = detail.project.id;
              const task = await actions.createTask(id, title, brief, workerId);
              setDetail((current) =>
                current?.project.id === id
                  ? { ...current, tasks: [...current.tasks, task] }
                  : current,
              );
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function ProjectCreateDialog({
  t,
  onClose,
  onCreate,
}: {
  t: BotHarnessTranslate;
  onClose(): void;
  onCreate(name: string, instructions: string): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <FormDialog
      title={t('projects.newProject')}
      labels={{ close: t('projects.close'), cancel: t('projects.close') }}
      busy={busy}
      error={error}
      submitLabel={t('projects.create')}
      submitDisabled={!name.trim()}
      onClose={onClose}
      onCancel={onClose}
      onSubmit={() => {
        setBusy(true);
        setError(undefined);
        void onCreate(name.trim(), instructions).then(onClose, (cause: unknown) => {
          setBusy(false);
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      }}
    >
      <TextField
        label={t('projects.name')}
        value={name}
        onChange={setName}
        maxLength={150}
        initialFocus
      />
      <TextAreaField
        label={t('projects.instructions')}
        value={instructions}
        onChange={setInstructions}
        rows={5}
      />
    </FormDialog>
  );
}
