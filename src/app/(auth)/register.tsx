/**
 * Register (M2-E).
 * Registers + creates a session; redirected to the customer shell on success.
 */
import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';

import { ActivityIndicator, Text, View } from 'react-native';

import { Button, Field, Logo, Screen } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import {
  authRedirectTarget,
  hasAuthRedirectTarget,
  resumeAfterAuth,
} from '@/modules/session/route-guard';
import { colors, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s-]{7,15}$/;

/** Shown for the single frame it takes to pop back to the guarded screen. */
function AuthResumeGate(): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Returning to your screen" />
    </View>
  );
}

export default function RegisterScreen(): React.JSX.Element {
  const { status, signUp } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = authRedirectTarget(params.next);
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [fieldError, setFieldError] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const validate = React.useCallback((): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) next.name = 'Enter your full name.';
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!phone.trim()) next.phone = 'Phone is required.';
    else if (!PHONE_RE.test(phone.trim())) next.phone = 'Enter a valid phone number.';
    if (!password) next.password = 'Password is required.';
    else if (password.length < 8) next.password = 'Use at least 8 characters.';
    if (confirm !== password) next.confirm = 'Passwords do not match.';
    setFieldError(next);
    return Object.keys(next).length === 0;
  }, [name, email, phone, password, confirm]);

  const submit = React.useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signUp({ name: name.trim(), email: email.trim(), phone: phone.trim(), password });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  }, [name, email, phone, password, signUp, validate]);

  // See login.tsx: a `?next=` sign-up is popped back to the guarded screen that
  // asked for it; a cold sign-up replaces into the customer shell.
  const resume = status === 'signedIn' && hasAuthRedirectTarget(params.next);
  React.useEffect(() => {
    if (resume) resumeAfterAuth(router);
  }, [resume, router]);

  if (resume) return <AuthResumeGate />;
  if (status === 'signedIn') return <Redirect href={next} />;

  return (
    <Screen padded>
      <Logo size={56} />
      <Text style={{ ...type.h2, ...{ marginTop: 12, marginBottom: 4  } }}>Create your account</Text>
      <Text style={{ ...type.h3, ...{ marginBottom: 24, color: colors.textMuted  } }}>
        Start shopping in a few steps.
      </Text>

      <Field label="Full name" value={name} onChangeText={setName} error={fieldError.name} />
      <Field
        label="Email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        error={fieldError.email}
      />
      <Field label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} error={fieldError.phone} />
      <Field
        label="Password"
        secure
        value={password}
        onChangeText={setPassword}
        error={fieldError.password}
        hint="At least 8 characters."
      />
      <Field label="Confirm password" secure value={confirm} onChangeText={setConfirm} error={fieldError.confirm} />

      {formError ? <Text style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8  } }}>{formError}</Text> : null}

      <Button title="Create Account" onPress={submit} loading={submitting} fullWidth />
      <Link href="/login" style={{ marginTop: 16 }}>
        <Text style={{ ...type.h3, ...{ color: colors.primary, textAlign: 'center'  } }}>
          Already have an account? Sign in
        </Text>
      </Link>
    </Screen>
  );
}