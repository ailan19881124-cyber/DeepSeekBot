// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import OwnerPairScreen from '../app/pair/owner';
import { firstHostAddress } from '../src/host/default-host';
import { t } from '../src/ui/strings';

vi.mock('react-native', () => import('./react-native-shim'));
vi.mock('expo-constants', () => ({ default: { deviceName: 'Test phone' } }));
vi.mock('../src/ui/primitives/keyboard-form', () => ({
  KeyboardFormScroll: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../src/ui/primitives/text', () => ({
  Text: ({
    children,
    accessibilityRole,
  }: {
    children: React.ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
}));
vi.mock('../src/ui/primitives/text-field', () => ({
  TextField: (props: {
    testID: string;
    value: string;
    secureTextEntry?: boolean;
    autoFocus?: boolean;
    onChangeText(value: string): void;
  }) => (
    <input
      data-testid={props.testID}
      type={props.secureTextEntry ? 'password' : 'text'}
      value={props.value}
      autoFocus={props.autoFocus}
      onChange={(event) => props.onChangeText(event.target.value)}
    />
  ),
}));
vi.mock('../src/ui/primitives/button', () => ({
  Button: (props: { testID?: string; disabled?: boolean; onPress(): void; label: string }) => (
    <button data-testid={props.testID} disabled={props.disabled} onClick={props.onPress}>
      {props.label}
    </button>
  ),
}));
const session = vi.hoisted(() => ({
  getState: () => ({ saved: null }),
  signInPassword: vi.fn(),
}));
const params = vi.hoisted(() => ({ url: undefined as string | undefined }));
const router = vi.hoisted(() => ({ dismissTo: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => router,
  useLocalSearchParams: () => params,
  useFocusEffect: () => undefined,
}));
vi.mock('../src/host/host-session', () => ({ hostSession: session }));
vi.mock('../src/host/native-conversation-filter', () => ({
  conversationFilter: { set: vi.fn() },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.unstubAllEnvs());

it('normalizes the injected HTTPS default only after loading an empty saved host list', () => {
  vi.stubEnv('EXPO_PUBLIC_DEFAULT_HOST_URL', ' https://studio.example/ ');
  expect(firstHostAddress(null)).toBe('https://studio.example');
  expect(firstHostAddress(undefined)).toBeUndefined();
  expect(firstHostAddress({ hostId: 'saved' })).toBeUndefined();
  vi.stubEnv('EXPO_PUBLIC_DEFAULT_HOST_URL', 'https://user:pass@studio.example');
  expect(firstHostAddress(null)).toBeUndefined();
  vi.stubEnv('EXPO_PUBLIC_DEFAULT_HOST_URL', undefined);
  expect(firstHostAddress(null)).toBeUndefined();
});

it('prefills the host, focuses the password, shows login errors and permits another attempt', async () => {
  vi.stubEnv('EXPO_PUBLIC_HOSTS', '[{"name":"Studio","url":"https://studio.example"}]');
  params.url = 'https://studio.example';
  session.signInPassword
    .mockResolvedValueOnce({ ok: false, code: 'credentials-invalid' })
    .mockResolvedValueOnce({ ok: true, value: { role: 'owner', hostId: 'studio' } });
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<OwnerPairScreen />));
    const password = element.querySelector<HTMLInputElement>(
      '[data-testid="owner-pair-password"]',
    )!;
    const submit = element.querySelector<HTMLButtonElement>('[data-testid="owner-pair-submit"]')!;
    expect(element.textContent).toContain('https://studio.example');
    expect(element.textContent).toContain(t.ownerSignIn.tailscaleFirst);
    expect(document.activeElement).toBe(password);
    const attempt = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          password,
          value,
        );
        password.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => submit.click());
    };
    await attempt('bad-input');
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      t.ownerSignIn.passwordInvalid,
    );
    expect(password.value).toBe('');
    expect(router.dismissTo).not.toHaveBeenCalled();
    await attempt('retry-input');
    expect(session.signInPassword).toHaveBeenLastCalledWith(
      expect.objectContaining({
        route: 'https://studio.example',
        username: 'owner',
        ownerOnly: true,
        password: 'retry-input',
      }),
    );
    expect(router.dismissTo).toHaveBeenCalledWith('/');
  } finally {
    act(() => root.unmount());
    element.remove();
    params.url = undefined;
  }
});
