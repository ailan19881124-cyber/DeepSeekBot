import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { expect, it } from 'vitest';
import { attachOperationalModule, mountOperationalDatabase } from '../src/database/owner.js';
import { BOT_HARNESS_SCHEMA_PLAN } from '../src/database/schema-plan.js';
import { projectToolsFor } from '../src/projects/tools.js';
import { createProjectStore } from '../src/projects/store.js';
import { setWorker } from '../src/memory/workers.js';
import { createTempRoot } from './helpers.js';
import { invoke } from './bot-create-cli-fixture.js';
import type { PersonaBotRecord } from '../src/bots/persona-bot.js';

it('runs the project and task CLI against the operational database', async () => {
  const home = createTempRoot();
  const instructions = join(home, 'instructions.md');
  writeFileSync(instructions, 'Review the release.\n');
  const call = (...args: string[]) => invoke(args, home);
  const created = await call(
    'project-create',
    '--name',
    'Release',
    '--instructions-file',
    instructions,
    '--cwd',
    home,
  );
  expect(created.code, created.stderr).toBe(0);
  const id = created.json.project.id;
  expect((await call('project-show', id)).json).toEqual(created.json);
  expect(created.json.project).toMatchObject({
    name: 'Release',
    cwd: home,
    instructions: 'Review the release.\n',
  });
  expect((await call('project-create', '--name', 'Broken', '--cwd', 'relative')).code).toBe(1);

  const result = await call(
    'task-create',
    '--project',
    id,
    '--title',
    'Check docs',
    '--brief',
    'Check navigation',
    '--worker',
    'reviewer',
  );
  expect(result.code, result.stderr).toBe(0);
  const task = result.json.task;
  expect(task).toMatchObject({
    projectId: id,
    assigneeWorkerId: 'reviewer',
    channelId: null,
    state: 'todo',
    revision: 1,
  });
  expect((await call('project-list')).json).toMatchObject({
    projects: [{ id, taskCount: 1, updatedAt: task.updatedAt }],
  });
  expect((await call('task-list', '--project', id, '--state', 'todo')).json).toEqual({
    tasks: [task],
  });
  expect((await call('task-list', '--project', id, '--state', 'review')).json).toEqual({
    tasks: [],
  });

  expect((await call('task-update', task.id, '--state', 'done')).json.error.code).toBe(
    'invalid-transition',
  );
  expect(
    (await call('task-update', task.id, '--state', 'doing', '--expected-revision', '9')).json.error
      .code,
  ).toBe('revision-conflict');
  for (const [index, next] of ['doing', 'review', 'done'].entries()) {
    const changed = await call(
      'task-update',
      task.id,
      '--state',
      next,
      '--expected-revision',
      String(index + 1),
    );
    expect(changed.code, changed.stderr).toBe(0);
    expect(changed.json.task).toMatchObject({ state: next, revision: index + 2 });
  }
  expect((await call('task-update', task.id, '--state', 'todo')).json.error.code).toBe(
    'invalid-transition',
  );
  expect(
    (
      await call(
        'task-create',
        '--project',
        id,
        '--title',
        'Invalid',
        '--brief',
        'Body',
        '--worker',
        '../escape',
      )
    ).code,
  ).toBe(1);
  const failure = (
    await call('task-create', '--project', id, '--title', 'Failure', '--brief', 'Body')
  ).json.task;
  expect((await call('task-update', failure.id, '--state', 'doing')).code).toBe(0);
  expect((await call('task-update', failure.id, '--state', 'failed')).json.task.state).toBe(
    'failed',
  );
});

it('registers project tools only for the Host owner’s assistant and rechecks calls', async () => {
  const home = createTempRoot();
  const root = join(home, 'memory');
  mkdirSync(root);
  setWorker(root, { id: 'reviewer', name: 'Reviewer', persona: 'Review', model: 'default' });
  const owner = mountOperationalDatabase({ dshHome: home, schemaPlan: BOT_HARNESS_SCHEMA_PLAN });
  const store = createProjectStore(attachOperationalModule(owner, 'projects'));
  let bot: PersonaBotRecord = {
    slug: 'ada',
    displayName: 'Ada',
    kind: 'assistant',
    workspaces: [],
    createdAt: new Date().toISOString(),
  };
  try {
    const tools = () =>
      projectToolsFor(
        store,
        () => bot,
        (record) => record.slug === 'ada',
        () => root,
      );
    const assistant = tools();
    expect(assistant.map(({ name }) => name)).toEqual([
      'project_create',
      'task_create',
      'task_list',
    ]);
    const run = async (name: string, args: Record<string, unknown>) =>
      JSON.parse(
        String(
          await assistant.find((tool) => tool.name === name)!.execute(args, {} as ToolRunContext),
        ),
      );
    const { project } = await run('project_create', { name: 'Release' });
    await expect(
      run('task_create', {
        project_id: project.id,
        title: 'Check',
        brief: 'Notes',
        worker_id: 'unknown',
      }),
    ).rejects.toThrow('Unknown worker');
    const { task } = await run('task_create', {
      project_id: project.id,
      title: 'Check',
      brief: 'Notes',
      worker_id: 'reviewer',
    });
    expect(task.assigneeWorkerId).toBe('reviewer');
    const { task: defaultTask } = await run('task_create', {
      project_id: project.id,
      title: 'Default',
      brief: 'Notes',
    });
    expect(defaultTask.assigneeWorkerId).toBeNull();
    expect((await run('task_list', { project_id: project.id, state: 'todo' })).tasks).toHaveLength(
      2,
    );
    bot = { ...bot, kind: 'bot' };
    expect(tools()).toEqual([]);
    await expect(run('project_create', { name: 'Denied' })).rejects.toThrow('permission-required');
    await expect(
      run('task_create', { project_id: project.id, title: 'Denied', brief: 'Notes' }),
    ).rejects.toThrow('permission-required');
    await expect(run('task_list', { project_id: project.id })).rejects.toThrow(
      'permission-required',
    );
    bot = { ...bot, slug: 'someone-else', kind: 'assistant' };
    expect(tools()).toEqual([]);
  } finally {
    owner.close();
  }
});
