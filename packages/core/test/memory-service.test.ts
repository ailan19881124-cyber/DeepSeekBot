import { createTestRegistry } from './registry-fixture.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { engineInstructions } from '../src/engines/engine-persona.js';
import { createEngineMemoryTools } from '../src/engines/engine-memory-tools.js';
import { describe, expect, it } from 'vitest';

import { createMemoryService, type MemoryService } from '../src/index.js';
import { ensureMemoryRepository } from '../src/memory/repository.js';
import { createTestOwnership, FIXED_NOW, createTempRoot, remember } from './helpers.js';

function initializeMemory(memoryDir: string) {
  const repository = ensureMemoryRepository({ memoryDir });
  return repository.ok ? { ok: true } : { ok: false, message: repository.code };
}

function setup(options: { memoryDir?: string; sharedRoot?: string } = {}): {
  registry: ReturnType<typeof createTestRegistry>;
  ownership: ReturnType<typeof createTestOwnership>;
  service: MemoryService;
} {
  const root = createTempRoot();
  const registry = createTestRegistry({
    rootDir: join(root, 'bots'),
    initializeMemory,
    sharedMemoryFor: () =>
      options.sharedRoot === undefined ? undefined : { path: options.sharedRoot, mode: 'symlink' },
  });
  const ownership = createTestOwnership();
  const created = registry.create({
    slug: 'research',
    displayName: 'Research',
    ...(options.memoryDir === undefined ? {} : { memoryDir: options.memoryDir }),
  });
  expect(created.ok).toBe(true);
  ownership.claim({
    sessionId: 'session-research',
    botSlug: 'research',
    rootRole: 'orchestrator',
    at: FIXED_NOW().toISOString(),
  });
  return {
    registry,
    ownership,
    service: createMemoryService({ registry, ownership, now: FIXED_NOW }),
  };
}

describe('createMemoryService', () => {
  it('resolves a store from explicit Session ownership, never from cwd', () => {
    const { registry, service } = setup();

    const store = service.storeForSession('session-research');
    expect(store).toBeDefined();
    expect(store?.memoryDir).toBe(registry.memoryDirFor('research'));
    expect(service.storeForSession('session-research')).toBe(store);
    expect(service.storeForAgent({ session: { id: 'session-research' } })).toBe(store);
    expect(service.memoryDirFor('session-research')).toBe(registry.memoryDirFor('research'));
    expect(service.repositoryFor('session-research')?.state).toBe('ready');

    expect(service.storeForSession('unowned-session')).toBeUndefined();
    expect(service.storeForSession(undefined)).toBeUndefined();
    expect(service.storeForAgent(undefined)).toBeUndefined();
    expect(service.storeForAgent({})).toBeUndefined();
    expect(service.repositoryFor('unowned-session')).toBeUndefined();
  });

  it('fails closed when the repository is missing instead of pretending Memory works', () => {
    const { registry, service } = setup();
    const memoryDir = registry.memoryDirFor('research');
    if (memoryDir === undefined) throw new Error('memory dir missing');
    rmSync(memoryDir, { recursive: true, force: true });

    expect(service.repositoryFor('session-research')).toEqual({ state: 'missing' });
    expect(service.storeForSession('session-research')).toBeUndefined();
  });

  it('freezes the persona for an existing Session and hands a later edit to new Sessions', () => {
    const { registry, ownership, service } = setup();
    const memoryDir = registry.memoryDirFor('research');
    if (memoryDir === undefined) throw new Error('memory dir missing');
    writeFileSync(join(memoryDir, 'SOUL.md'), '# Persona v1\n');

    const frozen = service.personaForSession('session-research');
    expect(frozen).toContain('## Soul (SOUL.md)');
    expect(frozen).toContain('# Persona v1');
    expect(frozen).toContain('## Core Memory (MEMORY.md)');
    expect(service.personaForSession('session-research')).toBe(frozen);
    expect(ownership.personaSnapshot('session-research')).toEqual({
      body: frozen,
      recordedAt: FIXED_NOW().toISOString(),
    });

    writeFileSync(join(memoryDir, 'SOUL.md'), '# Persona v2\n');
    writeFileSync(join(memoryDir, 'MEMORY.md'), '- grew a lot\n');
    expect(service.personaForSession('session-research')).toBe(frozen);

    ownership.claim({
      sessionId: 'session-second',
      botSlug: 'research',
      rootRole: 'orchestrator',
      at: FIXED_NOW().toISOString(),
    });
    expect(service.personaForSession('session-second')).toContain('# Persona v2');
    expect(service.personaForSession('session-second')).toContain('- grew a lot');

    expect(service.personaForSession('unowned-session')).toBe('');
    expect(service.personaForSession(undefined)).toBe('');
  });

  it('applies the Bot standing limits at the next snapshot, never to a running Session', () => {
    const { registry, service } = setup();
    const memoryDir = registry.memoryDirFor('research');
    if (memoryDir === undefined) throw new Error('memory dir missing');
    writeFileSync(join(memoryDir, 'MEMORY.md'), `${'记'.repeat(600)}\n`);

    const frozen = service.personaForSession('session-research');
    expect(frozen).toContain('## Core Memory (MEMORY.md) [20% — 600/3,000 chars]');

    registry.setStandingLimits('research', { soul: 5000, coreMemory: 500 });
    expect(service.personaForSession('session-research')).toBe(frozen);

    expect(service.refreshPersonaAfterCompaction('research', 'session-research')).toEqual({
      refreshed: true,
    });
    const refreshed = service.personaForSession('session-research');
    expect(refreshed).toContain('## Core Memory (MEMORY.md) [120% — 600/500 chars]');
    expect(refreshed).toContain(
      '[Truncated: MEMORY.md has 600 characters, over its 500-character limit.',
    );
  });

  it('honours a custom memory dir and keeps one store per dir', async () => {
    const root = createTempRoot();
    const memoryDir = join(root, 'custom-memory');
    const { registry, service } = setup({ memoryDir });

    expect(service.storeForSession('session-research')?.memoryDir).toBe(memoryDir);
    const store = service.storeForSession('session-research');
    expect(store).toBeDefined();
    if (store === undefined) return;
    await remember(store, { path: 'note.md', body: 'hello\n', summary: 'Note' });
    expect(service.storeForSession('session-research')?.read('note.md')?.body).toBe('hello\n');
    expect(registry.memoryDirFor('research')).toBe(memoryDir);
  });

  it('refreshes a frozen persona only when the file changed', () => {
    const { registry, service } = setup();
    const memoryDir = registry.memoryDirFor('research');
    if (memoryDir === undefined) throw new Error('memory dir missing');
    writeFileSync(join(memoryDir, 'SOUL.md'), '# Persona v1\n');
    expect(service.personaForSession('session-research')).toContain('# Persona v1');

    writeFileSync(join(memoryDir, 'SOUL.md'), '# Persona v2\n');
    expect(service.personaForSession('session-research')).toContain('# Persona v1');
    expect(service.refreshPersonaAfterCompaction('research', 'session-research')).toEqual({
      refreshed: true,
    });
    expect(service.personaForSession('session-research')).toContain('# Persona v2');
    expect(service.refreshPersonaAfterCompaction('research', 'session-research')).toEqual({
      refreshed: false,
    });

    expect(service.refreshPersonaAfterCompaction('research', 'unowned-session')).toEqual({
      refreshed: false,
    });
    expect(service.refreshPersonaAfterCompaction('other', 'session-research')).toEqual({
      refreshed: false,
    });
  });
});

describe('shared persona base', () => {
  it('keeps the exact standing prompt when no managed mount or base exists', () => {
    const root = createTempRoot();
    for (const sharedRoot of [undefined, root]) {
      const { registry, service } = setup(sharedRoot === undefined ? {} : { sharedRoot });
      const memory = registry.memoryDirFor('research')!;
      mkdirSync(join(memory, 'shared', 'persona'), { recursive: true });
      writeFileSync(join(memory, 'shared', 'persona', 'base.md'), 'unmanaged base');
      expect(service.sharedPersonaForEngineSession('session-research')).toBeUndefined();
      expect(service.personaForSession('session-research')).toBe(
        service.storeForSession('session-research')!.standingPrompt(),
      );
    }
  });

  it('orders the independently bounded base before Soul and Memory and refreshes it only on compaction', async () => {
    const sharedRoot = createTempRoot();
    const { registry, service } = setup({ sharedRoot });
    const base = join(sharedRoot, 'persona', 'base.md');
    mkdirSync(join(sharedRoot, 'persona'));
    mkdirSync(join(sharedRoot, 'worklog'));
    writeFileSync(join(sharedRoot, 'worklog', 'today.md'), 'private worklog body');
    writeFileSync(base, '🌱'.repeat(2001));
    const memory = registry.memoryDirFor('research')!;
    writeFileSync(join(memory, 'SOUL.md'), 'bot soul');
    writeFileSync(join(memory, 'MEMORY.md'), 'bot memory');

    const session = 'session-research';
    const frozen = service.sharedPersonaForEngineSession(session)!;
    expect(service.personaForSession(session)).toBe(frozen);
    expect(
      engineInstructions({ name: 'Research', standingPrompt: frozen, replyDelivery: '' }),
    ).toContain(frozen);
    const tools = createEngineMemoryTools(
      () => memory,
      () => sharedRoot,
    );
    expect(
      await tools
        .find(({ name }) => name === 'memory_read')!
        .run({ path: 'shared/worklog/today.md' }, AbortSignal.timeout(1000)),
    ).toBe('private worklog body');
    expect(
      await tools
        .find(({ name }) => name === 'memory_list')!
        .run({ path: './shared/worklog' }, AbortSignal.timeout(1000)),
    ).toContain('shared/worklog/today.md');
    expect(frozen).toMatch(/^## Shared Persona Base[\s\S]+## Soul[\s\S]+## Core Memory/u);
    expect(frozen).toContain('2,001/2,000 chars');
    expect(frozen).toContain('over its 2,000-character limit');
    expect([...frozen].filter((character) => character === '🌱')).toHaveLength(2000);
    expect(frozen).toContain('bot soul');
    expect(frozen).toContain('bot memory');
    expect(frozen).toContain('shared/worklog/');
    expect(frozen).not.toContain('private worklog body');

    writeFileSync(join(registry.rootDir, '..', 'bot-modes.json'), '{"sharedPersonaBaseLimit":4}');
    writeFileSync(base, 'newer base');
    expect(service.personaForSession(session)).toBe(frozen);
    expect(service.personaPending?.(session)).toBe(true);
    expect(service.refreshPersonaAfterCompaction('research', session)).toEqual({ refreshed: true });
    const refreshed = service.personaForSession(session);
    expect(refreshed).toContain('\n\nnewe\n');
    expect(refreshed).toContain('over its 4-character limit');
    expect(refreshed).not.toContain('newer base');
  });
});
