/**
 * M8: the "choose a new password" half of password recovery.
 *
 * Shared by the two routes that can reach it:
 *   - `/forgot-password`, after the link has been requested in-app;
 *   - `/reset-password`, which is where the mailed link actually points
 *     (`PUBLIC_APP_URL` defaults to `.../reset-password?token=...`).
 *
 * They are the same form because they are the same step. Duplicating it would
 * mean two places to keep the password rules and the error mapping in step.
 */
import * as React from 'react';

import { Text } from 'react-native';

import { Button, Field } from '@/components/ui';
import { authService } from '@/services/auth-gateway';
import { colors, type } from '@/theme/tokens';

export interface ResetConfirmProps {
  /** Pre-filled from the mailed link when the user arrived through one. */
  initialToken?: string;
  /** Shown instead of the token field when the token is already known. */
  onDone: () => void;
  /** Copy for the top of the card; the two callers word it differently. */
  heading: string;
  subheading: string;
}

export function ResetConfirm({ initialToken = '', onDone, heading, subheading }: ResetConfirmProps): React.JSX.Element {
  const [token, setToken] = React.useState(initialToken);
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const submit = React.useCallback(async () => {
    setFormError(null);
    if (!token.trim()) return setFormError('Paste the token from your reset email.');
    if (newPassword.length < 8) return setFormError('New password must be at least 8 characters.');
    if (newPassword !== confirmPassword) return setFormError('The two passwords do not match.');
    setSubmitting(true);
    try {
      await authService.confirmPasswordReset(token.trim(), newPassword);
      onDone();
    } catch (error) {
      // The server decides which token is bad and says so in one sentence; a
      // caller must not be able to tell "expired" from "never existed".
      setFormError(error instanceof Error ? error.message : 'Unable to reset your password.');
    } finally {
      setSubmitting(false);
    }
  }, [token, newPassword, confirmPassword, onDone]);

  return (
    <>
      <Text style={{ ...type.h2, ...{ marginBottom: 4  } }}>{heading}</Text>
      <Text style={{ ...type.h3, ...{ marginBottom: 20, color: colors.textMuted  } }}>{subheading}</Text>
      {initialToken ? null : (
        <Field label="Reset token" value={token} onChangeText={setToken} error={formError} autoCapitalize="none" />
      )}
      {initialToken ? <Text style={type.caption}>{formError}</Text> : null}
      <Field
        label="New password"
        secure
        value={newPassword}
        onChangeText={setNewPassword}
        hint="At least 8 characters."
      />
      <Field label="Confirm new password" secure value={confirmPassword} onChangeText={setConfirmPassword} />
      <Button title="Reset Password" onPress={submit} loading={submitting} fullWidth />
    </>
  );
}
