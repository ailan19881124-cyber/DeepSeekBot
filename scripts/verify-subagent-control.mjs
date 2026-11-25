import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocument } from 'yaml';

export async function verifySubagentControl(anchor, { source = false, profileDir } = {}) {
  const moduleUrl = (path) =>
    pathToFileURL(source ? path.replace(/[\\/]lib[\\/]index\.js$/u, '/src/index.ts') : path).href;
  const hostAnchor = realpathSync(anchor);
  const host = createRequire(hostAnchor);
  const control = host.resolve('@deepseek-ai/dsh-tool-subagent-control');
  const native = createRequire(control);
  const toolsPath = native.resolve('@deepseek-ai/dsh-tools');
  const toolImports = createRequire(toolsPath);
  const { Context } = await import(moduleUrl(native.resolve('@deepseek-ai/cordis')));
  const { default: Loader } = await import(
    moduleUrl(host.resolve('@deepseek-ai/cordis-plugin-loader'))
  );
  const { createScope } = await import(moduleUrl(toolImports.resolve('@deepseek-ai/dsh-scope')));
  const { default: SystemPrompt } = await import(
    moduleUrl(toolImports.resolve('@deepseek-ai/dsh-system-prompt'))
  );
  const { default: Tools } = await import(moduleUrl(toolsPath));
  const { default: AgentPresetRegistry } = await import(
    moduleUrl(host.resolve('@deepseek-ai/dsh-agent-preset-registry'))
  );
  const patch = parseDocument(
    readFileSync(new URL('../packages/deepseekbot/cordis.patch.yml', import.meta.url), 'utf8'),
  ).toJS();
  const preset = patch
    .flatMap((operation) => operation.insert ?? [])
    .find((entry) => entry.id === 'preset-deepseekbot').config;
  const controlRow = preset.plugins
    .find((entry) => entry.id === 'delegation')
    .config.find((entry) => entry.id === 'tool-subagent-control');
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(hostAnchor).href;
  try {
    if (profileDir !== undefined) {
      const { PluginPackages, createRuntimeResolution, loadProfileDirectory } = await import(
        moduleUrl(host.resolve('@deepseek-ai/dsh-app-boot'))
      );
      const profile = loadProfileDirectory('dsh', resolve(profileDir), hostAnchor);
      const resolution = await createRuntimeResolution({ installAnchor: hostAnchor, profile });
      ctx.baseUrl = new URL('./', pathToFileURL(resolve(profile.dir, 'package.json'))).href;
      await ctx.plugin(PluginPackages, { resolution });
    }
    await ctx.plugin(Loader);
    await ctx.plugin(SystemPrompt, { personaPrefix: '' });
    await ctx.plugin(Tools);
    ctx.provide('subagents', {
      rootOf: (agent) => agent,
      listChildren: async () => [],
      listDescendants: async () => [],
    });
    ctx.provide('agents', { get: () => undefined });
    ctx.provide('sessionProjections', { register: async () => ({}) });
    await ctx.plugin(AgentPresetRegistry, { default: preset.id });
    const unregister = await ctx.agentPresets.register({ id: preset.id, plugins: [controlRow] });
    const scopes = [{}, {}].map((key) => ({ key, ...createScope(ctx, key) }));
    const unrelated = createScope(ctx, {});
    assert.equal(ctx.tools.get('list_agents', unrelated.key), undefined);
    await unrelated.dispose();
    let renderedListing;
    for (const scope of scopes) {
      assert.deepEqual(await ctx.agentPresets.mount(scope.ctx, preset.id), { id: preset.id });
      const names = ctx.tools.schemas(scope.key).map((tool) => tool.name);
      for (const name of ['list_agents', 'send_message', 'interrupt_agent']) {
        assert.equal(names.filter((value) => value === name).length, 1, `${name} registers once`);
      }
      const listing = ctx.tools.get('list_agents', scope.key);
      const args = { scope: 'children' };
      const result = await listing.execute(args, {
        agent: { id: 'parent' },
        signal: new AbortController().signal,
      });
      const rendered = listing.output.render(args, result);
      assert.equal(rendered.length, 1);
      assert.equal(rendered[0].type, 'text');
      assert.match(rendered[0].text, /^(?:\(no subagents\)|lead \[inactive\] — root agent)$/u);
      renderedListing = rendered[0].text;
    }
    await scopes[0].dispose();
    assert.ok(ctx.tools.get('list_agents', scopes[1].key));
    await unregister();
    assert.ok(ctx.tools.get('list_agents', scopes[1].key));
    await scopes[1].dispose();
    assert.equal(ctx.tools.get('list_agents', scopes[1].key), undefined);
    return {
      preset: preset.id,
      tools: 'registered once per scope',
      listing: renderedListing,
      disposal: 'released after last scope',
    };
  } finally {
    await ctx.fiber.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { source: { type: 'boolean' }, 'profile-dir': { type: 'string' } },
  });
  const anchor = resolve(positionals[0] ?? 'node_modules/@deepseek-ai/dsh/package.json');
  console.log(
    JSON.stringify(
      await verifySubagentControl(anchor, {
        source: values.source,
        profileDir: values['profile-dir'],
      }),
    ),
  );
}
