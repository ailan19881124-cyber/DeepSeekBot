import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { within } from '../workspaces/space-paths.js';

export function readSharedPersonaBase(root: string): string | undefined {
  try {
    const file = realpathSync(join(root, 'persona', 'base.md'));
    if (!within(root, file) || !statSync(file).isFile()) return undefined;
    return readFileSync(file, 'utf8').trimEnd() || undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return undefined;
    throw error;
  }
}
