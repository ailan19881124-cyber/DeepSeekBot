import { ownerSignInOrigin } from '@botharness/host-client/owner-sign-in';

export function firstHostAddress(saved: unknown): string | undefined {
  const input = process.env.EXPO_PUBLIC_DEFAULT_HOST_URL;
  if (saved !== null || !input) return undefined;
  return ownerSignInOrigin(input);
}
