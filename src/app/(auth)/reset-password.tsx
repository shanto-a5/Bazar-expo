/**
 * Password reset from a mailed link (M8).
 *
 * The route the emailed `PUBLIC_APP_URL` points at, with the token already in the
 * query string. It exists because that link is the only way to reach this step
 * from outside the app; without it the mail would dead-end on a 404.
 *
 * The form itself is shared with `/forgot-password` — see `reset-confirm`.
 */
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { Button, Logo, Screen } from '@/components/ui';
import { ResetConfirm } from '@/modules/auth/reset-confirm';
import { useSession } from '@/modules/session/session-context';

export default function ResetPasswordScreen(): React.JSX.Element {
  const { status } = useSession();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (raw ?? '').trim();
  const [done, setDone] = React.useState(false);

  // Signed-in users are sent home rather than shown a form for an account they
  // already hold a valid session for.
  if (status === 'signedIn') return <Redirect href="/(home)" />;

  if (done) {
    return (
      <Screen padded>
        <Logo size={56} />
        <Button title="Sign In" onPress={() => router.replace('/login')} fullWidth />
      </Screen>
    );
  }

  return (
    <Screen padded>
      <Logo size={56} />
      {token ? (
        <ResetConfirm
          initialToken={token}
          heading="Choose a new password"
          subheading="This link can only be used once."
          onDone={() => setDone(true)}
        />
      ) : (
        <ResetConfirm
          heading="Reset token required"
          subheading="Open the link from your reset email, or request a new one."
          onDone={() => setDone(true)}
        />
      )}
    </Screen>
  );
}
