import * as React from 'react';

import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Field, Screen, SectionHeader } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { SignInGate } from '@/modules/session/route-guard';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { addressService } from '@/services/address-service';
import { AuthError, authService } from '@/services/auth-gateway';
import { notificationService } from '@/services/notification-service';
import { reviewService } from '@/services/review-service';
import { wishlistService } from '@/services/wishlist-service';
import { colors, spacing, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ProfileErrors {
  name?: string;
  email?: string;
  phone?: string;
}

export default function AccountScreen(): React.JSX.Element {
  const { user, refresh } = useSession();
  useFocusRefresh();
  const [name, setName] = React.useState(user?.name ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [phone, setPhone] = React.useState(user?.phone ?? '');
  const [profileErrors, setProfileErrors] = React.useState<ProfileErrors>({});
  const [profileNotice, setProfileNotice] = React.useState<string | null>(null);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [passwordErrors, setPasswordErrors] = React.useState<{ currentPassword?: string; newPassword?: string }>({});
  const [passwordNotice, setPasswordNotice] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [savingPassword, setSavingPassword] = React.useState(false);

  const userId = user?.id ?? '';
  const addresses = userId ? addressService.count(userId) : 0;
  const saved = userId ? wishlistService.productIds(userId).length : 0;
  const reviews = userId ? reviewService.listForUser(userId).length : 0;
  const unread = userId ? notificationService.unreadCount(userId) : 0;

  if (!user) {
    return (
      <SignInGate
        title="Account"
        message="Sign in to manage your profile, addresses, saved items and reviews."
      />
    );
  }

  const saveProfile = async (): Promise<void> => {
    setProfileNotice(null);
    setProfileError(null);
    const errors: ProfileErrors = {};
    if (name.trim().length < 2) errors.name = 'Please enter your full name.';
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
    setProfileErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSavingProfile(true);
    try {
      await authService.updateProfile(user.id, { name, email, phone });
      await refresh();
      setProfileNotice('Profile updated.');
    } catch (error) {
      if (error instanceof AuthError && error.field) {
        setProfileErrors({ [error.field]: error.message } as ProfileErrors);
      } else {
        setProfileError(error instanceof Error ? error.message : 'Unable to update your profile.');
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (): Promise<void> => {
    setPasswordNotice(null);
    setPasswordError(null);
    const errors: { currentPassword?: string; newPassword?: string } = {};
    if (!currentPassword) errors.currentPassword = 'Enter your current password.';
    if (newPassword.length < 8) errors.newPassword = 'Password must be at least 8 characters.';
    else if (newPassword !== confirmPassword) errors.newPassword = 'New passwords do not match.';
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSavingPassword(true);
    try {
      await authService.changePassword(user.id, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice('Password changed. Other signed-in sessions were signed out.');
    } catch (error) {
      if (error instanceof AuthError && error.field) {
        setPasswordErrors({ [error.field]: error.message });
      } else {
        setPasswordError(error instanceof Error ? error.message : 'Unable to change your password.');
      }
    } finally {
      setSavingPassword(false);
    }
  };

  // Quick accounts start with no owner password. This is the only chance to add
  // one without proving a current password — the server refuses the call once a
  // password exists, so the normal change flow below is the only path after this.
  const saveInitialPassword = async (): Promise<void> => {
    setPasswordNotice(null);
    setPasswordError(null);
    const errors: { newPassword?: string } = {};
    if (newPassword.length < 8) errors.newPassword = 'At least 8 characters.';
    else if (newPassword !== confirmPassword) errors.newPassword = 'Passwords do not match.';
    setPasswordErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSavingPassword(true);
    try {
      await authService.setInitialPassword(user.id, newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice('Password set. You can now sign in with it from any device.');
      await refresh();
    } catch (error) {
      if (error instanceof AuthError && error.field) {
        setPasswordErrors({ [error.field]: error.message });
      } else {
        setPasswordError(error instanceof Error ? error.message : 'Unable to set your password.');
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const needsPassword = user.hasPassword === false;

  return (
    <Screen padded>
      <BackButton fallbackHref="/settings" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md }}>Account</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>{user.email}</Text>

      <Card style={{ marginBottom: spacing.lg }}>
        <SectionHeader title="Profile" caption="Used on orders, invoices and seller listings" />
        <Field label="Full name" value={name} onChangeText={setName} error={profileErrors.name} />
        <Field
          label="Email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          error={profileErrors.email}
          hint="Used to sign in"
        />
        <Field
          label="Phone"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          error={profileErrors.phone}
          hint="Sellers and couriers use this to reach you"
        />
        {profileError ? <Text style={{ ...type.body, color: colors.danger, marginBottom: spacing.sm }}>{profileError}</Text> : null}
        {profileNotice ? (
          <Text style={{ ...type.body, color: colors.success, marginBottom: spacing.sm }}>{profileNotice}</Text>
        ) : null}
        <Button title="Save profile" onPress={saveProfile} loading={savingProfile} fullWidth />
      </Card>

      <Card style={{ marginBottom: spacing.lg }}>
        <SectionHeader
          title="Password"
          caption={needsPassword ? 'Add a password to sign in anywhere' : 'Keeps your account private'}
        />
        {needsPassword ? (
          <>
            <Text style={{ ...type.bodyMuted, marginBottom: spacing.md }}>
              Your account was created from your phone number, so it has no password yet. Set one to sign in from
              another device. This is the only time we can add one without your current password.
            </Text>
            <Field
              label="New password"
              secure
              value={newPassword}
              onChangeText={setNewPassword}
              error={passwordErrors.newPassword}
              hint="At least 8 characters"
            />
            <Field
              label="Confirm new password"
              secure
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={passwordErrors.newPassword}
            />
            <Button title="Set password" onPress={saveInitialPassword} loading={savingPassword} fullWidth />
          </>
        ) : (
          <>
            <Field
              label="Current password"
              secure
              value={currentPassword}
              onChangeText={setCurrentPassword}
              error={passwordErrors.currentPassword}
            />
            <Field
              label="New password"
              secure
              value={newPassword}
              onChangeText={setNewPassword}
              error={passwordErrors.newPassword}
              hint="At least 8 characters"
            />
            <Field
              label="Confirm new password"
              secure
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={passwordErrors.newPassword}
            />
            <Button title="Change password" onPress={savePassword} loading={savingPassword} fullWidth />
          </>
        )}
        {passwordError ? <Text style={{ ...type.body, color: colors.danger, marginTop: spacing.sm }}>{passwordError}</Text> : null}
        {passwordNotice ? (
          <Text style={{ ...type.body, color: colors.success, marginTop: spacing.sm }}>{passwordNotice}</Text>
        ) : null}
      </Card>

      <SectionHeader title="Account activity" />
      <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
        <Button
          title={`Address book (${addresses})`}
          variant="secondary"
          onPress={() => router.push('/addresses')}
          fullWidth
        />
        <Button
          title={`Saved items (${saved})`}
          variant="secondary"
          onPress={() => router.push('/wishlist')}
          fullWidth
        />
        <Button
          title={`My reviews (${reviews})`}
          variant="secondary"
          onPress={() => router.push('/my-reviews')}
          fullWidth
        />
        <Button
          title={`Notifications (${unread} unread)`}
          variant="secondary"
          onPress={() => router.push('/notifications')}
          fullWidth
        />
        <Button
          title="My orders"
          variant="secondary"
          onPress={() => router.push('/orders')}
          fullWidth
        />
      </View>

      <Text style={{ ...type.caption, textAlign: 'center' }}>
        Your orders, reviews and saved items stay with your account.
      </Text>
    </Screen>
  );
}
