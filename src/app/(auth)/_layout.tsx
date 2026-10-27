/**
 * Auth flow shell (M10-N1).
 *
 * These screens keep the native header. A sign-in / register / reset flow is
 * short and linear, and the platform header already provides a correct back
 * chevron with a `headerBackTitle` — so there is no reason to hand-roll a back
 * control or hide it.
 *
 * The stack options are shared with the other groups via
 * `@/modules/navigation/stack-options`; `login` is the group anchor so a cold
 * deep link into `register` or `forgot-password` still has somewhere to go back
 * to.
 */
import { Stack } from 'expo-router';
import * as React from 'react';

import {
  ROUTE_GROUP_ANCHORS,
  vantaAuthStackScreenOptions,
} from '@/modules/navigation/stack-options';

export const unstable_settings = { anchor: ROUTE_GROUP_ANCHORS.auth };

export default function AuthLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={vantaAuthStackScreenOptions}>
      <Stack.Screen name="login" options={{ title: 'Sign In', headerBackTitle: 'Back' }} />
      <Stack.Screen name="register" options={{ title: 'Create Account', headerBackTitle: 'Back' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset Password', headerBackTitle: 'Back' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Choose a New Password', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
