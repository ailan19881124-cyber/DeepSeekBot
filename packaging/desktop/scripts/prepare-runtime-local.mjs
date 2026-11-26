import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL('../build/runtime', import.meta.url));
const profile = join(runtime, 'profile');
const defaultUpstream = fileURLToPath(new URL('../../../', import.meta.url));

function parseUpstreamDir(argv) {
  const index = argv.indexOf('--upstream');
  if (index !== -1) {
    const value = argv[index + 1];
    if (!value) throw new Error('Missing value for --upstream');
    return resolve(value);
  }
  return resolve(process.env.DSHBOT_UPSTREAM_DIR || defaultUpstream);
}

const upstream = parseUpstreamDir(process.argv.slice(2));
const dsh = '@deepseek-ai/dsh';
const dshVersion = '0.2.2-rc.5';
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'deepseekbot'];

const localPackageDirs = [
  { dir: 'core', name: '@botharness/core' },
  { dir: 'client', name: '@botharness/ui' },
  { dir: 'browser', name: '@botharness/browser' },
  { dir: 'computer', name: '@botharness/computer' },
  { dir: 'deepseekbot', name: 'deepseekbot' },
];

const allowBuildsYaml = `nodeLinker: hoisted
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
`;

function runPnpm(args, cwd) {
  const result = spawnSync('pnpm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const workDir = await mkdtemp(join(tmpdir(), 'dshbot-local-pack-'));
const stageRoot = join(workDir, 'stage');
const tarballRoot = join(workDir, 'tarballs');

try {
  await mkdir(stageRoot, { recursive: true });
  await mkdir(tarballRoot, { recursive: true });

  const localVersions = new Map();
  const manifests = new Map();

  for (const pkg of localPackageDirs) {
    const srcDir = join(upstream, 'packages', pkg.dir);
    const manifestPath = join(srcDir, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.name !== pkg.name) {
      throw new Error(`Expected ${pkg.name} at ${srcDir}, found ${manifest.name}`);
    }
    localVersions.set(pkg.name, manifest.version);
    manifests.set(pkg.name, { srcDir, manifest });
  }

  const tarballs = new Map();

  for (const pkg of localPackageDirs) {
    const { srcDir, manifest } = manifests.get(pkg.name);
    const stageDir = join(stageRoot, pkg.dir);
    await mkdir(stageDir, { recursive: true });

    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (files.length === 0) {
      throw new Error(`Package ${pkg.name} has no files field in package.json`);
    }
    for (const rel of files) {
      const srcPath = join(srcDir, rel);
      await stat(srcPath);
      await cp(srcPath, join(stageDir, rel), { recursive: true, dereference: true });
    }

    const { private: _private, devDependencies: _devDeps, scripts: _scripts, ...clean } = manifest;
    if (clean.dependencies) {
      const nextDeps = {};
      for (const [depName, depSpec] of Object.entries(clean.dependencies)) {
        if (localVersions.has(depName)) {
          nextDeps[depName] = localVersions.get(depName);
        } else {
          if (/^(link:|workspace:|file:)/.test(depSpec)) {
            throw new Error(`Unexpected local/workspace dependency ${depName}: ${depSpec} in ${pkg.name}`);
          }
          nextDeps[depName] = depSpec;
        }
      }
      clean.dependencies = nextDeps;
    }

    await writeFile(join(stageDir, 'package.json'), JSON.stringify(clean, null, 2) + '\n');

    runPnpm(['pack', '--pack-destination', tarballRoot], stageDir);
    const filename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
    const tarballPath = join(tarballRoot, filename);
    await stat(tarballPath);
    tarballs.set(pkg.name, tarballPath);
  }

  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true });

  const installDeps = {
    [dsh]: dshVersion,
    ...Object.fromEntries([...tarballs.entries()].map(([name, file]) => [name, `file:${file}`])),
  };

  await writeFile(join(runtime, 'package.json'), JSON.stringify({
    name: 'dsh-bot-runtime',
    private: true,
    packageManager: 'pnpm@11.28.5',
    dependencies: installDeps,
  }, null, 2) + '\n');

  const overridesLines = [...tarballs.entries()]
    .map(([name, file]) => `  '${name}': 'file:${file}'`)
    .join('\n');

  await writeFile(join(runtime, 'pnpm-workspace.yaml'), `${allowBuildsYaml}overrides:\n${overridesLines}\n`);

  runPnpm([
    'install',
    '--prod',
    '--ignore-scripts=false',
    '--no-frozen-lockfile',
    '--config.node-linker=hoisted',
    '--config.package-import-method=copy',
  ], runtime);

  // Strip temporary tarball paths from runtime metadata so build/runtime is fully self-contained.
  const finalDeps = {
    [dsh]: dshVersion,
    ...Object.fromEntries([...localVersions.entries()]),
  };
  await writeFile(join(runtime, 'package.json'), JSON.stringify({
    name: 'dsh-bot-runtime',
    private: true,
    packageManager: 'pnpm@11.28.5',
    dependencies: finalDeps,
  }, null, 2) + '\n');
  await writeFile(join(runtime, 'pnpm-workspace.yaml'), allowBuildsYaml);
  await rm(join(runtime, 'pnpm-lock.yaml'), { force: true });

  const modules = join(runtime, 'node_modules');
  await stat(join(modules, dsh, 'lib/bin.js'));
  await stat(join(modules, 'deepseekbot', 'cordis.patch.yml'));
  await stat(join(modules, 'deepseekbot', 'dist/deepseekbot.mjs'));

  for (const pkg of localPackageDirs) {
    const installedPath = join(modules, pkg.name);
    const info = await lstat(installedPath);
    if (info.isSymbolicLink()) {
      throw new Error(`Expected real directory copy for ${pkg.name}, got symlink`);
    }
    const installedManifest = JSON.parse(await readFile(join(installedPath, 'package.json'), 'utf8'));
    if (installedManifest.version !== localVersions.get(pkg.name)) {
      throw new Error(`Version mismatch for ${pkg.name}: got ${installedManifest.version}`);
    }
  }

  for (const name of bundles) {
    const manifest = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'));
    if (!manifest.dsh?.bundle) throw new Error(`Missing DSH bundle metadata in ${name}`);
    if (name === 'deepseekbot' && manifest.dsh.bundle.patch !== './cordis.patch.yml') {
      throw new Error(`Unexpected deepseekbot bundle patch: ${manifest.dsh.bundle.patch}`);
    }
  }

  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-app',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles } },
  }, null, 2) + '\n');

  console.log(`Local runtime prepared at ${runtime} from ${upstream}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
