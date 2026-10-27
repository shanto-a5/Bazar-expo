/**
 * Forgot password (M8).
 *
 * Real recovery, in two steps, through `authService` — the screen never learns
 * which implementation is behind it and never touches a repository:
 *
 *   1. `requestPasswordReset(email)` — the server mails a single-use link. It
 *      answers the same way for an unknown address, so this step always advances
 *      and the wording below is deliberately identical either way. The old demo
 *      asked `emailExists` first and refused unknown addresses on screen, which
 *      turned the form into an account-enumeration oracle.
 *   2. `confirmPasswordReset(token, newPassword)` — the token from that link
 *      proves the mailbox is reachable, and the server invalidates every session
 *      once it succeeds.
 *
 * With no API configured the on-device service has no mail transport, so it
 * returns the token directly and it is shown as a clearly-labelled demo
 * affordance rather than pretending a message was sent.
 */
import { Redirect, router } from 'expo-router';
import * as React from 'react';

import { Text } from 'react-native';

import { Button, Field, Logo, Screen } from '@/components/ui';
import { ResetConfirm } from '@/modules/auth/reset-confirm';
import { authService } from '@/services/auth-gateway';
import { useSession } from '@/modules/session/session-context';
import { colors, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { status } = useSession();
  const [step, setStep] = React.useState<'email' | 'token' | 'success'>('email');
  const [email, setEmail] = React.useState('');
  /** Only set by the on-device service; see the note above. */
  const [localToken, setLocalToken] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const requestLink = React.useCallback(async () => {
    setFormError(null);
    if (!email.trim()) return setFormError('Enter your account email.');
    if (!EMAIL_RE.test(email.trim())) return setFormError('Enter a valid email address.');
    setSubmitting(true);
    try {
      const result = await authService.requestPasswordReset(email.trim());
      setLocalToken(result.localToken ?? null);
      setStep('token');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to send a reset link.');
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  if (status === 'signedIn') return <Redirect href="/(home)" />;

  return (
    <Screen padded>
      <Logo size={56} />
      {step === 'email' ? (
        <>
          <Text style={{ ...type.h2, ...{ marginBottom: 4  } }}>Forgot password</Text>
          <Text style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted  } }}>
            Enter your email and {"we'll"} send a reset link.
          </Text>
          <Field label="Email" keyboardType="email-address" value={email} onChangeText={setEmail} error={formError} />
          <Button title="Send Reset Link" onPress={requestLink} loading={submitting} fullWidth />
        </>
      ) : step === 'token' ? (
        <>
          {localToken ? (
            <Text style={{ ...type.h3, ...{ marginBottom: 20, color: colors.primary  } }}>
              No mail service is configured, so here is the token for this device: {localToken}
            </Text>
          ) : null}
          <ResetConfirm
            heading="Check your inbox"
            subheading={
              localToken
                ? 'Enter a new password to finish.'
                : `Open the link we sent to ${email.trim()} and paste its token below.`
            }
            onDone={() => setStep('success')}
          />
        </>
      ) : (
        <>
          <Text style={{ ...type.h2, ...{ marginBottom: 4  } }}>Password reset</Text>
          <Text style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted  } }}>
            Your password has been updated and every other session has been signed out.
          </Text>
          <Button title="Sign In" onPress={() => router.replace('/login')} fullWidth />
        </>
      )}
    </Screen>
  );
}
