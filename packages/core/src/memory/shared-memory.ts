import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { canonicalPath, within } from '../workspaces/space-paths.js';
import { OperationalDatabaseError } from '../database/owner.js';
import type { PersonaBotRecord } from '../bots/persona-bot.js';
import type { PersonaBotRegistry } from '../bots/registry.js';
import { createBotModeSettings } from '../runtime/bot-mode-settings.js';

const SHARED = 'shared';
const MARKER = '.botharness-shared-memory';
const STAGING = '.botharness-shared-memory-';
const LINK_UNAVAILABLE = new Set(['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP']);

type MountMode = 'symlink' | 'copy';
export type SharedMemoryMount = { path: string; mode: MountMode };
type Marker = { root: string; mode: MountMode; dev: number; ino: number };
type BotMemory = { slug: string; kind: PersonaBotRecord['kind']; dir: string };

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function lstat(path: string) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function validateRoot(input: string, dirs: readonly string[]): string {
  if (!isAbsolute(input)) throw new Error('Shared memory root must be an absolute path.');
  let root: string;
  try {
    root = realpathSync(input);
    if (!statSync(root).isDirectory()) throw new Error('Expected a directory.');
  } catch (cause) {
    throw new Error('Shared memory root must be an existing directory: ' + input, { cause });
  }
  for (const dir of dirs) {
    const actual = canonicalPath(dir);
    if (within(actual, root) || within(root, actual))
      throw new Error('Shared memory root must be separate from Bot memory directories: ' + dir);
  }
  return root;
}

function markerOf(dir: string): Marker | undefined {
  const marker = join(dir, MARKER);
  const entry = lstat(marker);
  const shared = join(dir, SHARED);
  const mount = lstat(shared);
  if (!entry?.isFile() || !mount) return undefined;
  try {
    const value = JSON.parse(readFileSync(marker, 'utf8')) as Marker | null;
    if (!value || typeof value !== 'object') return undefined;
    if (typeof value.root !== 'string' || value.dev !== mount.dev || value.ino !== mount.ino)
      return undefined;
    if (value.mode === 'copy' && mount.isDirectory()) return value;
    if (value.mode === 'symlink' && mount.isSymbolicLink() && readlinkSync(shared) === value.root)
      return value;
  } catch (error) {
    if (!(error instanceof SyntaxError) && !absent(error)) throw error;
  }
  return undefined;
}

function copyTree(source: string, destination: string, readOnly: boolean): void {
  mkdirSync(destination);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to, readOnly);
    if (entry.isFile()) {
      copyFileSync(from, to);
      if (readOnly) chmodSync(to, lstatSync(to).mode & 0o555);
    }
  }
  if (readOnly) chmodSync(destination, 0o555);
}

function removeStaging(path: string): void {
  const entry = lstat(path);
  if (entry?.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) removeStaging(join(path, name));
    rmdirSync(path);
  } else rmSync(path, { force: true });
}

export function removeSharedMemoryMount(dir: string): void {
  change([{ slug: '', dir, kind: undefined }], '', () => {});
}

function readOnlyCopy(path: string): boolean {
  const entry = lstat(path);
  if (!entry || entry.isSymbolicLink() || (entry.mode & 0o222) !== 0) return false;
  return !entry.isDirectory() || readdirSync(path).every((name) => readOnlyCopy(join(path, name)));
}

function ignoreShared(dir: string): void {
  const path = join(dir, '.gitignore');
  const entry = lstat(path);
  if (entry && !entry.isFile()) throw new Error('Expected a regular .gitignore: ' + path);
  const existing = entry ? readFileSync(path, 'utf8') : '';
  const rules = ['/shared', '/' + MARKER, '/' + STAGING + '*'].join('\n');
  if (!existing.trimEnd().replaceAll('\r\n', '\n').endsWith(rules))
    appendFileSync(path, (existing && !existing.endsWith('\n') ? '\n' : '') + rules + '\n');
}

function prepare(bot: BotMemory, root: string) {
  const { dir } = bot;
  const previous = markerOf(dir);
  const shared = join(dir, SHARED);
  const marker = join(dir, MARKER);
  if (!root && !previous) return undefined;
  if (!previous && (lstat(shared) || lstat(marker)))
    throw new Error('Cannot replace an unmanaged shared memory path in ' + dir);
  if (root) ignoreShared(dir);
  const staging = mkdtempSync(join(dir, STAGING));
  const paths = [SHARED, MARKER];
  const stage = (name: string) => staging + '-' + name;
  const dispose = () => {
    for (const name of ['next', 'marker', ...paths, ...paths.map((name) => 'undo-' + name)])
      removeStaging(stage(name));
    rmdirSync(staging);
  };
  const moved: string[] = [];
  const installed: string[] = [];
  try {
    if (root) {
      const target = stage('next');
      let mode: MountMode = 'copy';
      if (bot.kind === 'assistant') {
        try {
          symlinkSync(root, target, 'dir');
          mode = 'symlink';
        } catch (error) {
          if (!LINK_UNAVAILABLE.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
        }
      }
      if (mode === 'copy') copyTree(root, target, bot.kind !== 'assistant');
      const { dev, ino } = lstatSync(target);
      writeFileSync(stage('marker'), JSON.stringify({ root, mode, dev, ino }));
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    install() {
      if (previous) {
        for (const name of paths) {
          renameSync(join(dir, name), stage(name));
          moved.push(name);
        }
      }
      if (root) {
        renameSync(stage('next'), shared);
        installed.push(SHARED);
        renameSync(stage('marker'), marker);
        installed.push(MARKER);
      }
    },
    rollback() {
      for (const name of installed) renameSync(join(dir, name), stage('undo-' + name));
      for (const name of moved) renameSync(stage(name), join(dir, name));
    },
    dispose,
  };
}

function change(bots: readonly BotMemory[], root: string, save: () => void): void {
  const staged: Array<NonNullable<ReturnType<typeof prepare>>> = [];
  try {
    for (const bot of bots) {
      const mount = prepare(bot, root);
      if (mount) staged.push(mount);
    }
    for (const mount of staged) mount.install();
    save();
  } catch (error) {
    if (!(error instanceof OperationalDatabaseError && error.code === 'post-commit-interrupted'))
      for (const mount of staged.reverse()) mount.rollback();
    throw error;
  } finally {
    for (const mount of staged) mount.dispose();
  }
}

export function createSharedMemory(settingsDir: string) {
  const settings = createBotModeSettings(settingsDir);
  const botsOf = (registry: PersonaBotRegistry, historical = false): BotMemory[] =>
    (historical ? registry.listHistorical() : registry.list()).map(({ slug, kind }) => ({
      slug,
      kind,
      dir: registry.memoryDirFor(slug)!,
    }));
  const mountFor = (dir: string, root: string): SharedMemoryMount | undefined => {
    if (!root) return undefined;
    const marker = markerOf(dir);
    if (marker?.root !== root) return undefined;
    const path = join(dir, SHARED);
    if (marker.mode === 'symlink') {
      if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) return undefined;
      if (canonicalPath(root) !== root) return undefined;
      return { path: root, mode: 'symlink' };
    }
    return { path: canonicalPath(path), mode: 'copy' };
  };
  const status = (registry: PersonaBotRegistry) => {
    const sharedMemoryRoot = settings.sharedMemoryRoot();
    return {
      sharedMemoryRoot,
      mounts: botsOf(registry).map(({ slug, dir }) => {
        const mount = mountFor(dir, sharedMemoryRoot);
        return {
          slug,
          path: join(dir, SHARED),
          mode: mount?.mode ?? 'unmounted',
          readOnly: mount
            ? mount.mode === 'copy'
              ? readOnlyCopy(mount.path)
              : (statSync(mount.path).mode & 0o222) === 0
            : null,
        };
      }),
    };
  };
  return {
    status,
    set(registry: PersonaBotRegistry, input: string) {
      const bots = botsOf(registry);
      const root = validateRoot(
        input,
        registry.listHistorical().map(({ slug }) => registry.memoryDirFor(slug)!),
      );
      change(bots, root, () => settings.setSharedMemoryRoot(root));
      return status(registry);
    },
    clear(registry: PersonaBotRegistry) {
      if (settings.sharedMemoryRoot())
        change(botsOf(registry, true), '', () => settings.setSharedMemoryRoot(''));
      return status(registry);
    },
    mountFor(dir: string) {
      return mountFor(dir, settings.sharedMemoryRoot());
    },
    validateMemoryDir(dir: string) {
      const root = settings.sharedMemoryRoot();
      if (root) validateRoot(root, [dir]);
    },
    mountNew(dir: string, bot: PersonaBotRecord, save: () => void) {
      const root = settings.sharedMemoryRoot();
      if (!root) return save();
      change([{ slug: bot.slug, kind: bot.kind, dir }], validateRoot(root, [dir]), save);
    },
  };
}
