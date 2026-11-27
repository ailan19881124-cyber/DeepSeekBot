import { ownerSignInOrigin } from '@botharness/host-client/owner-sign-in';
import type { SavedHost } from '@botharness/host-client/hosts';

export type ConfiguredHost = { name: string; url: string };

export function parseConfiguredHosts(input: string | undefined): ConfiguredHost[] {
  if (!input) return [];
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const hosts = new Map<string, ConfiguredHost>();
  for (const row of value) {
    if (typeof row?.name !== 'string' || typeof row.url !== 'string') continue;
    const name = row.name.trim();
    const url = ownerSignInOrigin(row.url);
    if (name && url && !hosts.has(url)) hosts.set(url, { name, url });
  }
  return [...hosts.values()];
}

export const configuredHosts = () => parseConfiguredHosts(process.env.EXPO_PUBLIC_HOSTS);

export function deviceChoices(configured: readonly ConfiguredHost[], saved: readonly SavedHost[]) {
  const shown = new Set<string>();
  const configuredChoices = configured.map((host) => {
    const paired = saved.find((item) =>
      item.routes.some((route) => ownerSignInOrigin(route) === host.url),
    );
    if (paired) shown.add(paired.hostId);
    return { ...host, saved: paired };
  });
  return [
    ...configuredChoices,
    ...saved
      .filter((host) => !shown.has(host.hostId))
      .map((host) => ({
        name: host.hostName,
        url: host.routes[0] ?? '',
        saved: host,
      })),
  ];
}
