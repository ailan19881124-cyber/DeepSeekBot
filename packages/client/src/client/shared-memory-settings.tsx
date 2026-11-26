import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { space } from './ds/tokens.stylex.js';
import { Button } from './ds/button.js';
import { TextField } from './ds/field.js';
import { useMountedResource } from './mounted-resource.js';
import type { BridgeActions } from './actions.js';
import type { BotHarnessTranslate } from './locale.js';
import type { SharedMemoryActions } from '@botharness/host-client/shared-memory';

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: space.x3 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: space.x2 },
});

export function SharedMemorySettings({
  actions,
  t,
}: {
  actions: Pick<BridgeActions, 'sharedMemory' | 'pickWorkspaceFolder'>;
  t: BotHarnessTranslate;
}) {
  const [status, setStatus] = useState<Awaited<ReturnType<SharedMemoryActions['status']>>>();
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mount = useMountedResource<HTMLDivElement>(() => {
    let active = true;
    void actions.sharedMemory?.status().then(
      (result) => {
        if (!active) return;
        setStatus(result);
        setDir(result.sharedMemoryRoot);
      },
      (cause: unknown) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [actions.sharedMemory]);
  const run = async (operation: 'enable' | 'refresh' | 'clear' | 'pick') => {
    const shared = actions.sharedMemory;
    if (!shared) return;
    setBusy(true);
    setError(undefined);
    try {
      if (operation === 'pick') {
        const selected = await actions.pickWorkspaceFolder();
        if (selected) setDir(selected);
      } else {
        const result =
          operation === 'clear'
            ? await shared.clear()
            : await shared.set(operation === 'refresh' ? status!.sharedMemoryRoot : dir);
        setStatus(result);
        setDir(result.sharedMemoryRoot);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={mount} {...stylex.props(styles.stack)}>
      <TextField
        label={t('sharedMemory.directory')}
        value={dir}
        onChange={setDir}
        disabled={busy}
      />
      <div {...stylex.props(styles.actions)}>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void run('pick');
          }}
        >
          {t('sharedMemory.choose')}
        </Button>
        <Button
          variant="primary"
          disabled={busy || !dir.trim()}
          onClick={() => {
            void run('enable');
          }}
        >
          {t('sharedMemory.enable')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status?.sharedMemoryRoot}
          onClick={() => {
            void run('refresh');
          }}
        >
          {t('sharedMemory.refresh')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !status?.sharedMemoryRoot}
          onClick={() => {
            void run('clear');
          }}
        >
          {t('sharedMemory.clear')}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {status?.mounts.map((item) => (
          <li key={item.slug}>
            {item.slug} · {item.mode}
            {item.readOnly ? ' · ' + t('sharedMemory.readOnly') : ''} · {item.path}
          </li>
        ))}
      </ul>
    </div>
  );
}
