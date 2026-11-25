import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import nativeFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { invoke } from './bot-create-cli-fixture.js';
import { createTempRoot } from './helpers.js';
import { createCore } from '../src/plugin.js';
import { createBridgeMethods } from '../src/bridge/methods.js';
import { nativeExecutionRoot, nativeFileToolDenial } from '../src/workspaces/grant-native-tools.js';
import { OWNER_HUMAN_CONTEXT } from '../src/humans/context.js';

function fixture() {
  const home = createTempRoot('shared-memory-host-');
  const root = createTempRoot('shared-memory-root-');
  writeFileSync(join(root, 'work.md'), 'shared work');
  const command = (...args: string[]) => invoke(['shared-memory', ...args], home);
  const memoryDir = (slug: string) => join(home, 'botharness', 'bots', slug, 'memory');
  return { home, root, command, memoryDir };
}

it('leaves Bot memory alone while sharing is disabled', async () => {
  const { home, command, memoryDir } = fixture();
  const result = await invoke(['create', '--name', 'Ada'], home);
  expect(result.code).toBe(0);
  const dir = memoryDir(result.json.bot.id);
  expect(existsSync(join(dir, 'shared'))).toBe(false);
  expect(existsSync(join(home, 'botharness', 'bot-modes.json'))).toBe(false);
  expect((await command('status')).json).toMatchObject({
    sharedMemoryRoot: '',
    mounts: [{ mode: 'unmounted', readOnly: null }],
  });
});

it('mounts existing Bots, excludes shared entries from Git, and clears without touching the source', async () => {
  const { home, root, command, memoryDir } = fixture();
  const assistant = await invoke(['create', '--name', 'Ada', '--kind', 'assistant'], home);
  const bot = await invoke(['create', '--name', 'Reviewer', '--kind', 'bot'], home);
  expect(assistant.code).toBe(0);
  expect(bot.code).toBe(0);
  const ada = memoryDir(assistant.json.bot.id);
  const reviewer = memoryDir(bot.json.bot.id);
  try {
    const result = await command('set', '--dir', root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.json.sharedMemoryRoot).toBe(root);
    expect(result.json.mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: join(ada, 'shared'), mode: 'symlink', readOnly: false }),
        expect.objectContaining({ path: join(reviewer, 'shared'), mode: 'copy', readOnly: true }),
      ]),
    );
    expect((await command('status')).json).toEqual(result.json);
    expect(lstatSync(join(ada, 'shared')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(reviewer, 'shared', 'work.md'), 'utf8')).toBe('shared work');
    expect(statSync(join(reviewer, 'shared')).mode & 0o222).toBe(0);
    expect(statSync(join(reviewer, 'shared', 'work.md')).mode & 0o222).toBe(0);
    if (process.getuid && process.getuid() !== 0) {
      expect(() => writeFileSync(join(reviewer, 'shared', 'work.md'), 'denied')).toThrow();
      expect(() => writeFileSync(join(reviewer, 'shared', 'other.md'), 'denied')).toThrow();
    }
    writeFileSync(join(ada, 'shared', 'work.md'), 'updated by assistant');
    for (const dir of [ada, reviewer]) {
      expect(
        execFileSync('git', ['check-ignore', 'shared'], {
          cwd: dir,
          encoding: 'utf8',
          windowsHide: true,
        }),
      ).toBe('shared\n');
    }
  } finally {
    const cleared = await command('clear');
    expect(cleared.code, cleared.stderr).toBe(0);
    expect(cleared.json.sharedMemoryRoot).toBe('');
  }
  expect(existsSync(join(ada, 'shared'))).toBe(false);
  expect(existsSync(join(reviewer, 'shared'))).toBe(false);
  expect(readFileSync(join(root, 'work.md'), 'utf8')).toBe('updated by assistant');
});

it('automatically mounts new Bots in both the running Host and offline CLI', async () => {
  const { home, root, command, memoryDir } = fixture();
  expect((await command('set', '--dir', root)).code).toBe(0);
  const offline = await invoke(['create', '--name', 'Offline', '--kind', 'assistant'], home);
  expect(offline.code, offline.stderr).toBe(0);
  expect(lstatSync(join(memoryDir(offline.json.bot.id), 'shared')).isSymbolicLink()).toBe(true);
  const core = createCore({ dshHome: home });
  try {
    const bridge = createBridgeMethods(OWNER_HUMAN_CONTEXT, core);
    const created = await core.registry.createAsync({ slug: 'live', displayName: 'Live' });
    expect(created.ok).toBe(true);
    for (const [slug, kind] of [
      [offline.json.bot.id as string, 'assistant'],
      ['live', 'bot'],
    ] as const) {
      const session = { id: slug, header: { cwd: memoryDir(slug) } } as never;
      core.ownership.claim({
        sessionId: slug,
        botSlug: slug,
        rootRole: 'orchestrator',
        at: new Date().toISOString(),
      });
      const args = { file_path: 'shared/work.md' };
      expect(nativeFileToolDenial(core, session, 'read', args)).toBeUndefined();
      if (kind === 'assistant') {
        expect(nativeFileToolDenial(core, session, 'write', args)).toBeUndefined();
        expect(nativeExecutionRoot(core, session, 'write', args)).toBe(root);
      } else {
        expect(nativeFileToolDenial(core, session, 'write', args)).toBe(
          'Shared memory is read-only for this Bot',
        );
      }
    }
    expect(bridge.sharedMemory('status')).toMatchObject({
      ok: true,
      value: {
        mounts: expect.arrayContaining([
          { slug: 'live', path: join(memoryDir('live'), 'shared'), mode: 'copy', readOnly: true },
        ]),
      },
    });
    expect(bridge.sharedMemory('clear')).toMatchObject({
      ok: true,
      value: { sharedMemoryRoot: '' },
    });
  } finally {
    await core.runtime.close();
    core.schedules.close();
    core.externalMessaging.close();
    core.operationalDatabase.close();
  }
});

it('rejects relative, missing, file, nested and symlink-aliased roots without changing configuration', async () => {
  const { home, root, command, memoryDir } = fixture();
  const bot = await invoke(['create', '--name', 'Reviewer'], home);
  expect(bot.code).toBe(0);
  const nested = join(memoryDir(bot.json.bot.id), 'nested');
  mkdirSync(nested);
  const alias = join(root, 'alias');
  symlinkSync(nested, alias, 'dir');
  for (const invalid of ['relative', join(root, 'missing'), join(root, 'work.md'), nested, alias]) {
    const result = await command('set', '--dir', invalid);
    expect(result.code).toBe(1);
    expect(result.json.error.code).toBe('shared-memory-failed');
    expect((await command('status')).json.sharedMemoryRoot).toBe('');
    expect(existsSync(join(home, 'botharness', 'bot-modes.json'))).toBe(false);
  }
});

it('preserves an existing unmanaged shared directory when setting or clearing', async () => {
  const { home, root, command, memoryDir } = fixture();
  const bot = await invoke(['create', '--name', 'Reviewer'], home);
  expect(bot.code).toBe(0);
  const unmanaged = join(memoryDir(bot.json.bot.id), 'shared');
  mkdirSync(unmanaged);
  writeFileSync(join(unmanaged, 'personal.md'), 'my notes');
  expect((await command('set', '--dir', root)).json.error.message).toContain('unmanaged');
  expect((await command('clear')).json.sharedMemoryRoot).toBe('');
  expect(readFileSync(join(unmanaged, 'personal.md'), 'utf8')).toBe('my notes');
});

it('uses a writable local copy when the filesystem refuses assistant symlinks', async () => {
  const { home, root, command, memoryDir } = fixture();
  const assistant = await invoke(['create', '--name', 'Assistant', '--kind', 'assistant'], home);
  expect(assistant.code).toBe(0);
  const link = vi.spyOn(nativeFs, 'symlinkSync').mockImplementation(() => {
    throw Object.assign(new Error('symlinks unavailable'), { code: 'EPERM' });
  });
  syncBuiltinESMExports();
  try {
    const result = await command('set', '--dir', root);
    expect(result.code, result.stderr).toBe(0);
    expect(result.json.mounts).toMatchObject([{ mode: 'copy', readOnly: false }]);
    writeFileSync(join(memoryDir(assistant.json.bot.id), 'shared', 'work.md'), 'local only');
    expect(readFileSync(join(root, 'work.md'), 'utf8')).toBe('shared work');
  } finally {
    link.mockRestore();
    syncBuiltinESMExports();
    expect((await command('clear')).code).toBe(0);
  }
});
