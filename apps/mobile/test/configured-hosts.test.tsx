// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import DeviceListScreen from '../app/pair/devices';
import { parseConfiguredHosts } from '../src/host/configured-hosts';
import { probeHost } from '../src/host/probe-host';
import { t } from '../src/ui/strings';

const fixture = vi.hoisted(() => {
  const saved = {
    hostId: 'saved-id',
    hostName: 'Saved computer',
    routes: ['https://saved.example'],
    credential: 'fixture-device-token',
    deviceId: 'fixture-device',
  };
  return {
    saved,
    fetch: vi.fn(),
    push: vi.fn(),
    dismissTo: vi.fn(),
    filter: vi.fn(),
    switchTo: vi.fn(async (_id: string) => true),
  };
});
vi.mock('expo/fetch', () => ({ fetch: fixture.fetch }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    useRouter: () => fixture,
  };
});
vi.mock('react-native', async () => ({
  ...(await import('./react-native-shim')),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
  }: {
    data: Array<{ url: string }>;
    renderItem(input: { item: { url: string } }): React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.map((item) => (
        <div key={item.url}>{renderItem({ item })}</div>
      ))}
      {ListFooterComponent}
    </div>
  ),
}));
vi.mock('../src/host/host-session', () => {
  const hosts = [fixture.saved];
  return { useHostSession: () => ({ saved: fixture.saved, hosts }), hostSession: fixture };
});
vi.mock('../src/host/native-conversation-filter', () => ({
  conversationFilter: { set: fixture.filter },
}));
vi.mock('../src/ui/primitives/settings-row', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingsRow: ({
    title,
    detail,
    onPress,
    testID,
  }: {
    title: string;
    detail: string;
    onPress?: () => void;
    testID: string;
  }) => (
    <button data-testid={testID} onClick={onPress}>
      {title} {detail}
    </button>
  ),
}));
vi.mock('../src/ui/primitives/button', () => ({ Button: () => null }));
vi.mock('../src/ui/primitives/text', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../src/ui/chat/sheet', () => ({ SHEET_GROUP: 'sheet' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.unstubAllEnvs());

it('accepts unique HTTPS origins and ignores malformed entries', () => {
  expect(parseConfiguredHosts(undefined)).toEqual([]);
  expect(parseConfiguredHosts('{')).toEqual([]);
  expect(parseConfiguredHosts('{}')).toEqual([]);
  expect(
    parseConfiguredHosts(
      JSON.stringify([
        null,
        { name: ' Mac ', url: 'https://mac.example/' },
        { name: 'duplicate', url: 'https://mac.example' },
        { name: 'unsafe', url: 'http://plain.example' },
        { name: 'bad', url: 'https://host.example/path' },
        { name: 'credentials', url: 'https://user@host.example' },
      ]),
    ),
  ).toEqual([{ name: 'Mac', url: 'https://mac.example' }]);
});

it('probes the root without credentials and treats 401 as online', async () => {
  fixture.fetch.mockResolvedValueOnce({ status: 401 });
  expect(await probeHost('https://mac.example', new AbortController().signal)).toBe(true);
  expect(fixture.fetch).toHaveBeenLastCalledWith(
    'https://mac.example/',
    expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }),
  );
});

it('marks a timed-out probe offline', async () => {
  const timeout = new AbortController();
  const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
  fixture.fetch.mockImplementationOnce(
    (_url, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('Timed out', { cause: signal.reason })),
          { once: true },
        );
      }),
  );
  try {
    const status = probeHost('https://mac.example', new AbortController().signal);
    expect(timer).toHaveBeenCalledWith(5000);
    timeout.abort();
    expect(await status).toBe(false);
  } finally {
    timer.mockRestore();
  }
});

it('shows online and offline devices, requests a password for an unpaired device and switches saved devices directly', async () => {
  vi.stubEnv(
    'EXPO_PUBLIC_HOSTS',
    JSON.stringify([
      { name: 'Mac', url: 'https://mac.example' },
      { name: 'AIMS', url: 'https://aims.example' },
    ]),
  );
  fixture.fetch.mockImplementation(async (url: string) => {
    if (url.includes('aims')) throw new Error('unreachable');
    return { status: 401 };
  });
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<DeviceListScreen />));
    expect(element.textContent).toContain(`https://mac.example · ${t.deviceList.online}`);
    expect(element.textContent).toContain(`https://aims.example · ${t.deviceList.offline}`);
    expect(element.textContent).toContain(t.deviceList.tailscale);
    await act(async () =>
      element
        .querySelector<HTMLButtonElement>('[data-testid="device-row-https://mac.example"]')
        ?.click(),
    );
    expect(fixture.push).toHaveBeenCalledWith({
      pathname: '/pair/owner',
      params: { url: 'https://mac.example' },
    });
    await act(async () =>
      element.querySelector<HTMLButtonElement>('[data-testid="device-row-saved-id"]')?.click(),
    );
    expect(fixture.switchTo).toHaveBeenCalledWith('saved-id');
    expect(fixture.dismissTo).toHaveBeenCalledWith('/');
  } finally {
    act(() => root.unmount());
    element.remove();
  }
});
