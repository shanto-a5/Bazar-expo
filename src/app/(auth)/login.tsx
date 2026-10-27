/**
 * Login (M2-E).
 * Reads session authority from context; form validation lives here, auth logic
 * (hash/compare/session creation) lives in the auth service only.
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
// The server accepts an email or a phone number as the identifier; this matches
// the same phone shape the quick-account popup uses.
const PHONE_RE = /^[0-9+\-\s]{6,20}$/;

/** Shown for the single frame it takes to pop back to the guarded screen. */
function AuthResumeGate(): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Returning to your screen" />
    </View>
  );
}

export default function LoginScreen(): React.JSX.Element {
  const { status, signIn } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = authRedirectTarget(params.next);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldError, setFieldError] = React.useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const validate = React.useCallback((): boolean => {
    const value = email.trim();
    const errors: { email?: string; password?: string } = {};
    // An account can sign in by email or by phone; a phone alone is never enough,
    // because the password field below is always required.
    if (!value) errors.email = 'Enter your email or phone number.';
    else if (!EMAIL_RE.test(value) && !PHONE_RE.test(value)) errors.email = 'Enter a valid email or phone number.';
    if (!password) errors.password = 'Password is required.';
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }, [email, password]);

  const submit = React.useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to sign in. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, signIn, validate]);

  /**
   * Two ways in, and they must not be confused (M10-N1):
   *  - Entered to satisfy a guarded route (`?next=`): the auth screen was pushed
   *    on top of the shell that needs the session, so pop back to it and let it
   *    re-render. Navigating to `next` instead would rebuild the destination
   *    shell from its anchor and lose the route the user came from.
   *  - Entered cold (no `next`): nothing is underneath, so replace into the
   *    customer shell.
   */
  const resume = status === 'signedIn' && hasAuthRedirectTarget(params.next);
  React.useEffect(() => {
    if (resume) resumeAfterAuth(router);
  }, [resume, router]);

  if (resume) return <AuthResumeGate />;
  if (status === 'signedIn') return <Redirect href={next} />;

  return (
    <Screen padded>
      <Logo size={56} />
      <Text style={{ ...type.h2, ...{ marginTop: 12, marginBottom: 4  } }}>Welcome back</Text>
      <Text style={{ ...type.h3, ...{ marginBottom: 24, color: colors.textMuted  } }}>Sign in to continue shopping.</Text>

      <Field
        label="Email or phone"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        error={fieldError.email}
        hint="Demo customer: customer@vanta.app / customer123"
      />
      <Field
        label="Password"
        secure
        value={password}
        onChangeText={setPassword}
        error={fieldError.password}
        hint="Demo seller: seller@vanta.app / seller123"
      />

      {formError ? (
        <Text style={{ ...type.h3, ...{ color: colors.danger, marginTop: 8  } }}>{formError}</Text>
      ) : null}

      <Button title="Sign In" onPress={submit} loading={submitting} fullWidth />
      <Link href="/forgot-password" style={{ marginTop: 12 }} accessibilityRole="link">
        <Text style={{ ...type.caption, color: colors.textMuted, textAlign: 'center' }}>Forgot your password?</Text>
      </Link>
        <Link href="/register" style={{ marginTop: 16 }}>
    <Text style={{ ...type.h3, ...{ color: colors.primary, textAlign: 'center' } }}>{"Don't have an account? Create one"}</Text>
  </Link>
    </Screen>
  );
}