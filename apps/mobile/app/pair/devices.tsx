import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { configuredHosts, deviceChoices } from '../../src/host/configured-hosts';
import { computerEnvironmentKey } from '../../src/host/conversation-environments';
import { hostSession, useHostSession } from '../../src/host/host-session';
import { conversationFilter } from '../../src/host/native-conversation-filter';
import { probeHost } from '../../src/host/probe-host';
import { SHEET_GROUP } from '../../src/ui/chat/sheet';
import { space } from '../../src/ui/design/tokens';
import { Button } from '../../src/ui/primitives/button';
import { SettingsRow, SettingsSection } from '../../src/ui/primitives/settings-row';
import { Text } from '../../src/ui/primitives/text';
import { useStrings } from '../../src/ui/strings';

export default function DeviceListScreen() {
  const router = useRouter();
  const t = useStrings();
  const { saved, hosts } = useHostSession();
  const [configured] = useState(configuredHosts);
  const devices = useMemo(() => deviceChoices(configured, hosts), [configured, hosts]);
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(false);
  const switching = useRef(false);
  const [busy, setBusy] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      setStatus({});
      for (const { url } of devices) {
        if (!url.startsWith('https://')) continue;
        void probeHost(url, controller.signal).then((online) => {
          if (!controller.signal.aborted) setStatus((previous) => ({ ...previous, [url]: online }));
        });
      }
      return () => controller.abort();
    }, [devices, refresh]),
  );

  const select = async (device: (typeof devices)[number]) => {
    if (switching.current) return;
    if (!device.saved) {
      router.push({ pathname: '/pair/owner', params: { url: device.url } });
      return;
    }
    switching.current = true;
    setBusy(true);
    setError(false);
    try {
      if (!(await hostSession.switchTo(device.saved.hostId))) {
        setError(true);
        return;
      }
      conversationFilter.set(computerEnvironmentKey(device.saved.hostId));
      router.dismissTo('/');
    } catch {
      setError(true);
    } finally {
      switching.current = false;
      setBusy(false);
    }
  };

  const offline = Object.values(status).some((online) => !online);
  return (
    <FlatList
      testID="device-list"
      data={devices}
      contentContainerStyle={{ padding: space.x5, gap: space.x3 }}
      keyExtractor={(device) => device.saved?.hostId + '-' + device.url}
      ListHeaderComponent={offline ? <Text tone="muted">{t.deviceList.tailscale}</Text> : undefined}
      ListFooterComponent={
        <View style={{ gap: space.x3 }}>
          {error ? (
            <Text accessibilityRole="alert" tone="danger">
              {t.deviceList.switchFailed}
            </Text>
          ) : null}
          <Button
            label={t.deviceList.refresh}
            variant="text"
            on="canvas"
            disabled={busy}
            onPress={() => setRefresh((value) => value + 1)}
          />
          <Button
            label={t.ownerSignIn.otherComputer}
            variant="text"
            on="canvas"
            disabled={busy}
            onPress={() => router.push('/pair')}
          />
        </View>
      }
      renderItem={({ item }) => {
        const state = !item.url.startsWith('https://')
          ? undefined
          : status[item.url] === true
            ? t.deviceList.online
            : status[item.url] === false
              ? t.deviceList.offline
              : t.deviceList.checking;
        return (
          <SettingsSection on={SHEET_GROUP}>
            <SettingsRow
              testID={`device-row-${item.saved?.hostId ?? item.url}`}
              on={SHEET_GROUP}
              icon="computer"
              title={item.name}
              detail={[item.url, state].filter(Boolean).join(' · ')}
              {...(item.saved?.hostId === saved?.hostId && item.saved
                ? { control: { kind: 'check' as const } }
                : { disclosure: true })}
              onPress={busy ? undefined : () => void select(item)}
            />
          </SettingsSection>
        );
      }}
    />
  );
}
