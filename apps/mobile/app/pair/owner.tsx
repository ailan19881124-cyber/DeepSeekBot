import Constants from 'expo-constants';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { computerEnvironmentKey } from '../../src/host/conversation-environments';
import { firstHostAddress } from '../../src/host/default-host';
import { hostSession } from '../../src/host/host-session';
import { conversationFilter } from '../../src/host/native-conversation-filter';
import { space } from '../../src/ui/design/tokens';
import { Button } from '../../src/ui/primitives/button';
import { KeyboardFormScroll } from '../../src/ui/primitives/keyboard-form';
import { Text } from '../../src/ui/primitives/text';
import { TextField } from '../../src/ui/primitives/text-field';
import { useStrings } from '../../src/ui/strings';

export default function OwnerPairScreen() {
  const t = useStrings();
  const router = useRouter();
  const [route] = useState(() => firstHostAddress(hostSession.getState().saved));
  const [username, setUsername] = useState('owner');
  const [editUsername, setEditUsername] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);

  useFocusEffect(useCallback(() => () => pending.current?.abort(), []));
  if (!route) return <Redirect href="/" />;

  const submit = async () => {
    if (pending.current || !password || !username.trim()) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError(undefined);
    try {
      const result = await hostSession.signInPassword({
        route,
        username: username.trim(),
        password,
        deviceName: Constants.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android phone'),
        ownerOnly: true,
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setPassword('');
      if (!result.ok) {
        const copy: Record<string, string> = {
          ...t.teamSignIn.errors,
          'credentials-invalid': t.ownerSignIn.passwordInvalid,
          'owner-sign-in-disabled': t.ownerSignIn.disabled,
          'already-paired': t.ownerSignIn.alreadyPaired,
        };
        setError(
          (
            copy[result.code] ??
            t.teamSignIn.errors.generic ??
            t.ownerSignIn.passwordInvalid
          ).replace('{seconds}', String(result.retryAfterSeconds ?? 60)),
        );
        return;
      }
      conversationFilter.set(computerEnvironmentKey(result.value.hostId));
      router.dismissTo('/');
    } catch {
      if (!request.signal.aborted) setError(t.teamSignIn.errors.generic);
    } finally {
      pending.current = undefined;
      setBusy(false);
    }
  };

  return (
    <KeyboardFormScroll contentContainerStyle={{ padding: space.x5, gap: space.x4 }}>
      <Text tone="muted">{t.ownerSignIn.tailscaleFirst}</Text>
      <Text variant="meta" tone="muted">
        {route}
      </Text>
      {editUsername ? (
        <TextField
          testID="owner-pair-username"
          accessibilityLabel={t.teamSignIn.username}
          label={t.teamSignIn.username}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          editable={!busy}
        />
      ) : null}
      <TextField
        testID="owner-pair-password"
        accessibilityLabel={t.teamSignIn.password}
        label={t.teamSignIn.password}
        placeholder={t.teamSignIn.password}
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          setError(undefined);
        }}
        autoFocus
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        editable={!busy}
        onSubmitEditing={() => void submit()}
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        testID="owner-pair-submit"
        label={t.teamSignIn.signIn}
        tone="primary"
        on="canvas"
        busy={busy}
        disabled={busy || !password || !username.trim()}
        onPress={() => void submit()}
      />
      {!editUsername ? (
        <Button
          label={t.ownerSignIn.changeUsername}
          variant="text"
          on="canvas"
          disabled={busy}
          onPress={() => setEditUsername(true)}
        />
      ) : null}
      <Button
        label={t.ownerSignIn.otherComputer}
        variant="text"
        on="canvas"
        disabled={busy}
        onPress={() => router.replace('/pair')}
      />
    </KeyboardFormScroll>
  );
}
