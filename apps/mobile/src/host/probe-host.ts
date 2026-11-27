import { fetch } from 'expo/fetch';

export async function probeHost(origin: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(new URL('/', origin).href, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    void response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
