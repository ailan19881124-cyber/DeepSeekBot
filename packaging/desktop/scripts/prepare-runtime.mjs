import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL('../build/runtime', import.meta.url));
const profile = join(runtime, 'profile');
const tobs = '@botharness/tobs';
const dsh = '@deepseek-ai/dsh';
const dependencies = { [tobs]: '1.7.0', [dsh]: '0.2.2-rc.5' };
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', tobs];

await mkdir(runtime, { recursive: true });
await rm(profile, { recursive: true, force: true });
await writeFile(join(runtime, 'package.json'), JSON.stringify({
  name: 'dsh-bot-runtime',
  private: true,
  packageManager: 'pnpm@11.28.5',
  dependencies,
}, null, 2) + '\n');
await writeFile(join(runtime, 'pnpm-workspace.yaml'), `nodeLinker: hoisted
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  esbuild: true
  koffi: true
  node-pty: true
  sharp: true
  workerd: true
  puppeteer: false
  '@google/genai': false
  protobufjs: false
  agent-browser: false
  react-native-enriched-markdown: false
`);

const args = ['install', '--prod', '--ignore-scripts=false', '--no-frozen-lockfile', '--config.node-linker=hoisted', '--config.package-import-method=copy'];
const result = spawnSync('pnpm', args, {
  cwd: runtime,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const modules = join(runtime, 'node_modules');
await stat(join(modules, dsh, 'lib/bin.js'));
for (const name of bundles) {
  const manifest = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'));
  if (!manifest.dsh?.bundle) throw new Error(`Missing DSH bundle metadata in ${name}`);
}

await mkdir(profile);
await writeFile(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-app',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles } },
}, null, 2) + '\n');
console.log(`Runtime prepared at ${runtime}`);
