import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { invoke } from './bot-create-cli-fixture.js';
import { createTempRoot } from './helpers.js';

it('lists, creates, edits and removes workers in the Bot Memory working tree', async () => {
  const home = createTempRoot();
  const created = await invoke(['create', '--name', 'Ada'], home);
  expect(created.code).toBe(0);
  const bot: string = created.json.bot.id;
  const command = (name: string, ...params: string[]) =>
    invoke([name, '--bot', bot, ...params], home);
  const jsonFile = join(home, 'worker.json');
  const markdownFile = join(home, 'worker.md');
  const template = {
    id: 'review',
    name: 'Reviewer',
    persona: 'Find regressions.',
    model: 'default',
  };
  expect((await command('worker-list')).json).toEqual({ workers: [] });
  writeFileSync(jsonFile, JSON.stringify(template));
  expect((await command('worker-set', '--file', jsonFile)).json).toEqual({ worker: template });
  const path = join(home, 'botharness', 'bots', bot, 'memory', 'workers', 'review.json');
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(template);

  writeFileSync(
    markdownFile,
    '---\nid: review\nname: Reviewer\nmodel: {provider: deepseek, model: pro}\nskills: [triage]\n---\nReview carefully.\n',
  );
  const edited = {
    ...template,
    persona: 'Review carefully.',
    model: { provider: 'deepseek', model: 'pro' },
    skills: ['triage'],
  };
  expect((await command('worker-set', '--file', markdownFile)).json).toEqual({ worker: edited });
  expect((await command('worker-list')).json).toEqual({ workers: [edited] });

  for (const invalid of [
    { id: '../escape' },
    { model: { provider: 'deepseek' } },
    { skills: ['../escape'] },
    { persona: ' ' },
  ]) {
    writeFileSync(jsonFile, JSON.stringify({ ...template, ...invalid }));
    expect((await command('worker-set', '--file', jsonFile)).code).not.toBe(0);
  }
  expect((await command('worker-remove', '--id', '../escape')).code).not.toBe(0);
  expect((await command('worker-list')).json).toEqual({ workers: [edited] });
  expect((await command('worker-remove', '--id', 'review')).json).toEqual({ removed: true });
  expect(existsSync(path)).toBe(false);
  expect((await command('worker-list')).json).toEqual({ workers: [] });
});
