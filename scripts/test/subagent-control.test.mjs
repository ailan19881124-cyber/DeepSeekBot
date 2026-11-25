import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
describe('native subagent control compatibility', () => {
  it('registers and calls native tools in independent disposable scopes on the pinned Host', () => {
    const output = execFileSync(process.execPath, ['scripts/verify-subagent-control.mjs'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      timeout: 10_000,
      shell: false,
      windowsHide: true,
    });
    expect(JSON.parse(output)).toEqual({
      preset: 'deepseekbot',
      tools: 'registered once per scope',
      listing: '(no subagents)',
      disposal: 'released after last scope',
    });
  });
});
