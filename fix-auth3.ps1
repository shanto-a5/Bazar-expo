$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$uiPath = Join-Path $root "src\components\ui.tsx"

$uiText = [IO.File]::ReadAllText($uiPath)
if (-not $uiText.Contains('function Logo')) {
  $uiText = $uiText -replace "import {", "import {" 
  $addLogo = @'

export function Logo({ size = 228, style }: { size?: number; style?: ViewStyle }): React.JSX.Element {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={require('../../assets/logos/SquareWhite.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="Vanta"
      />
    </View>
  );
}
'@
  $uiText = $uiText.TrimEnd() + "`n" + $addLogo + "`n"
  [IO.File]::WriteAllText($uiPath, $uiText)
  Write-Output "PATCHED ui.tsx :: added Logo"
} else {
  Write-Output "NOCHANGE ui.tsx :: Logo already present"
}

$login = @'
/**
 * Login (M2-E).
 * Reads session authority from context; form validation lives here, auth logic
 * (hash/compare/session creation) lives in the auth service only.
 */
import { Link, Redirect, router } from 'expo-router';
import * as React from 'react';

import { Button, Field, Logo, Screen } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { colors, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen(): React.JSX.Element {
  const { status, signIn } = useSession();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fieldError, setFieldError] = React.useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (status === 'signedIn') return <Redirect href="/home" />;

  const validate = (): boolean => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!password) next.password = 'Password is required.';
    else if (password.length < 6) next.password = 'Password must be at least 6 characters.';
    setFieldError(next);
    return Object.keys(next).length === 0;
  };

  const submit = React.useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/home');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to sign in. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, signIn]);

  return (
    <Screen padded>
      <Logo size={56} />
      <h2 style={[type.h2, { marginTop: 12, marginBottom: 4 }]}>Welcome back</h2>
      <h3 style={[type.h3, { marginBottom: 24, color: colors.textMuted }]}>Sign in to continue shopping.</h3>

      <Field
        label="Email"
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
        <h4 style={[type.h3, { color: colors.danger, marginTop: 8 }]}>{formError}</h4>
      ) : null}

      <Button title="Sign In" onPress={submit} loading={submitting} fullWidth />
      <Link href="/register" style={{ marginTop: 16 }}>
        <h4 style={[type.h3, { color: colors.primary, textAlign: 'center' }]}>
          Don&apos;t have an account? Create one
        </h4>
      </Link>
    </Screen>
  );
}
'@

$register = @'
/**
 * Register (M2-E).
 * Registers + creates a session; redirected to the customer shell on success.
 */
import { Link, Redirect, router } from 'expo-router';
import * as React from 'react';

import { Button, Field, Logo, Screen } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { colors, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s-]{7,15}$/;

export default function RegisterScreen(): React.JSX.Element {
  const { status, signUp } = useSession();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [fieldError, setFieldError] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (status === 'signedIn') return <Redirect href="/home" />;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) next.name = 'Enter your full name.';
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (!phone.trim()) next.phone = 'Phone is required.';
    else if (!PHONE_RE.test(phone.trim())) next.phone = 'Enter a valid phone number.';
    if (!password) next.password = 'Password is required.';
    else if (password.length < 6) next.password = 'Use at least 6 characters.';
    if (confirm !== password) next.confirm = 'Passwords do not match.';
    setFieldError(next);
    return Object.keys(next).length === 0;
  };

  const submit = React.useCallback(async () => {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signUp({ name: name.trim(), email: email.trim(), phone: phone.trim(), password });
      router.replace('/home');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  }, [name, email, phone, password, signUp, validate]);

  return (
    <Screen padded>
      <Logo size={56} />
      <h2 style={[type.h2, { marginTop: 12, marginBottom: 4 }]}>Create your account</h2>
      <h3 style={[type.h3, { marginBottom: 24, color: colors.textMuted }]}>
        Start shopping in a few steps.
      </h3>

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
        hint="At least 6 characters."
      />
      <Field label="Confirm password" secure value={confirm} onChangeText={setConfirm} error={fieldError.confirm} />

      {formError ? <h4 style={[type.h3, { color: colors.danger, marginTop: 8 }]}>{formError}</h4> : null}

      <Button title="Create Account" onPress={submit} loading={submitting} fullWidth />
      <Link href="/login" style={{ marginTop: 16 }}>
        <h4 style={[type.h3, { color: colors.primary, textAlign: 'center' }]}>
          Already have an account? Sign in
        </h4>
      </Link>
    </Screen>
  );
}
'@

$forgot = @'
/**
 * Forgot password (M2-E password-recovery-sim).
 * Simulated recovery: any registered email yields a fresh 6-digit one-time code
 * echoed to the screen (demo only). Auth hashing/verification stays service-side.
 */
import { Redirect, router } from 'expo-router';
import * as React from 'react';

import { Button, Field, Logo, Screen } from '@/components/ui';
import { authService } from '@/services/auth-service';
import { useSession } from '@/modules/session/session-context';
import { colors, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { status } = useSession();
  const [step, setStep] = React.useState<'email' | 'code' | 'success'>('email');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sentCode, setSentCode] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (status === 'signedIn') return <Redirect href="/home" />;

  const sendCode = React.useCallback(async () => {
    setFormError(null);
    if (!email.trim()) return setFormError('Enter your account email.');
    if (!EMAIL_RE.test(email.trim())) return setFormError('Enter a valid email address.');
    setSubmitting(true);
    try {
      const exists = await authService.emailExists(email.trim());
      if (!exists) throw new Error('No account found with this email.');
      const demoCode = String(Math.floor(100000 + Math.random() * 900000));
      setSentCode(demoCode);
      setStep('code');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to send recovery code.');
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  const verifyCode = React.useCallback(async () => {
    setFormError(null);
    if (code.trim() !== sentCode) return setFormError('That code does not match. Try again.');
    if (newPassword.length < 6) return setFormError('New password must be at least 6 characters.');
    setSubmitting(true);
    try {
      await authService.resetPassword(email.trim(), newPassword);
      setStep('success');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to reset password.');
    } finally {
      setSubmitting(false);
    }
  }, [code, sentCode, newPassword, email]);

  return (
    <Screen padded>
      <Logo size={56} />
      {step === 'email' ? (
        <>
          <h2 style={[type.h2, { marginBottom: 4 }]}>Forgot password</h2>
          <h3 style={[type.h3, { marginBottom: 20, color: colors.textMuted }]}>
            Enter your email and we&apos;ll send a recovery code.
          </h3>
          <Field
            label="Email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={formError}
          />
          <Field label="Recovery code" value={code} onChangeText={setCode} hint="Enter the 6-digit code above." />
          <Field label="New password" secure value={newPassword} onChangeText={setNewPassword} hint="At least 6 characters." />
          {step === 'code' && sentCode ? (
            <h3 style={[type.h3, { marginBottom: 20, color: colors.primary }]}>Demo code: {sentCode}</h3>
          ) : null}
          <Button title="Send Recovery Code" onPress={sendCode} loading={submitting} fullWidth />
          {step === 'code' ? <Button title="Reset Password" onPress={verifyCode} loading={submitting} fullWidth /> : null}
        </>
      ) : (
        <>
          <h2 style={[type.h2, { marginBottom: 4 }]}>Password reset</h2>
          <h3 style={[type.h3, { marginBottom: 20, color: colors.textMuted }]}>Your password has been updated.</h3>
          <Button title="Sign In" onPress={() => router.replace('/login')} fullWidth />
        </>
      )}
    </Screen>
  );
}
'@

$paths = @{
  "src\app\(auth)\login.tsx" = $login
  "src\app\(auth)\register.tsx" = $register
  "src\app\(auth)\forgot-password.tsx" = $forgot
}
foreach ($rel in $paths.Keys) {
  $full = Join-Path $root $rel
  [IO.File]::WriteAllText($full, $paths[$rel])
  Write-Output ("WROTE " + $full)
}

$layout = Join-Path $root "src\app\(auth)\_layout.tsx"
$lt = [IO.File]::ReadAllText($layout)
if ($lt.Contains('name="index"')) {
  $lt = $lt -replace '(\r?\n)\s*<Stack\.Screen name="index" options=\{\{ headerShown: false \}\} />', ''
  [IO.File]::WriteAllText($layout, $lt)
  Write-Output "PATCHED (auth)/_layout.tsx :: removed stale index screen"
} else {
  Write-Output "NOCHANGE (auth)/_layout.tsx :: no index screen"
}
