import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, taka } from '@/components/ui';
import { SummaryRow } from '@/modules/checkout/checkout-ui';
import { BKASH_DEMO, bkashService, type BkashReceipt, type BkashSession } from '@/services/bkash-service';
import { bkashBrand, colors, makeShadow, radius, spacing, type } from '@/theme/tokens';
import { formatDateTime } from '@/utils/time';

/**
 * A local, in-app stand-in for the bKash app's payment screen. It is presented
 * as a dedicated sheet so the customer sees a real wallet/OTP/PIN checkout,
 * but nothing leaves the device. `onSuccess` hands the caller a local
 * `TRX-VANTA-...` reference which the order service records on the existing
 * payment transaction.
 */
type Stage = 'wallet' | 'otp' | 'pin' | 'processing' | 'success';

const PROCESSING_MS = 1400;

export function BkashPaymentSheet({
  visible,
  amount,
  stores,
  onCancel,
  onSuccess,
}: {
  visible: boolean;
  amount: number;
  /** Names of the stores actually being paid, taken from the live checkout. */
  stores: string[];
  onCancel: () => void;
  onSuccess: (receipt: BkashReceipt) => void;
}): React.JSX.Element {
  const [stage, setStage] = React.useState<Stage>('wallet');
  const [wallet, setWallet] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [session, setSession] = React.useState<BkashSession | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [receipt, setReceipt] = React.useState<BkashReceipt | null>(null);
  const successSent = React.useRef(false);

  // Cancel/close is a no-op while the payment is mid-flight or already
  // successful, so the customer cannot abandon a receipt that is being banked.
  const close = React.useCallback(() => {
    if (stage === 'processing' || stage === 'success') return;
    if (session) bkashService.cancel(session);
    setSession(null);
    setError(null);
    onCancel();
  }, [onCancel, session, stage]);

  const submitWallet = (): void => {
    const result = bkashService.start(wallet);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSession(result.value);
    setError(null);
    setOtp('');
    setStage('otp');
  };

  const submitOtp = (): void => {
    if (!session) return;
    const result = bkashService.verifyOtp(session, otp);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setPin('');
    setStage('pin');
  };

  const submitPin = (): void => {
    if (!session) return;
    const result = bkashService.verifyPin(session, pin);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setReceipt(result.value);
    setStage('processing');
  };

  const resendOtp = (): void => {
    if (!session) return;
    const next = bkashService.resendOtp(session);
    setSession(next);
    setOtp('');
    setError(null);
  };

  // The processing beat is deliberate: a wallet payment is never instant, and
  // jumping straight to the receipt hides whether the order was actually saved.
  React.useEffect(() => {
    if (stage !== 'processing') return;
    const timer = setTimeout(() => setStage('success'), PROCESSING_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  const finish = (): void => {
    if (!receipt || successSent.current) return;
    successSent.current = true;
    onSuccess(receipt);
  };

  const masked = session?.masked ?? '';
  const busy = stage === 'processing' || stage === 'success';
  // A wallet payment is made to one merchant, so a multi-store cart is shown as
  // the lead store plus a count rather than a wall of names.
  const merchant =
    stores.length === 0
      ? 'Vanta order'
      : stores.length === 1
        ? stores[0]
        : `${stores[0]} +${stores.length - 1} more`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent={false}>
      <View style={styles.root}>
        <View style={styles.brandBar}>
          <View>
            <Text style={styles.brandWord}>bKash</Text>
            <Text style={styles.brandSub}>Secure checkout</Text>
          </View>
          {!busy ? (
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Cancel bKash payment"
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.brandCancel}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {stage === 'wallet' ? (
            <View>
              <Text style={styles.h1}>Enter your wallet number</Text>
              <Text style={styles.lede}>
                We will send an OTP to your bKash account to confirm this payment.
              </Text>
              <Card style={styles.card}>
                <SummaryRow label="Amount to pay" value={taka(amount)} tone="primary" />
                <SummaryRow label="Payment to" value={merchant} />
              </Card>
              <Field
                label="bKash wallet number"
                value={wallet}
                onChangeText={(next) => {
                  setWallet(next);
                  if (error) setError(null);
                }}
                placeholder="01XXXXXXXXX"
                keyboardType="number-pad"
                error={error}
                hint={`Simulator wallet: ${BKASH_DEMO.wallet}`}
                accessibilityLabel="bKash wallet number"
              />
              <Button title="Send OTP" onPress={submitWallet} fullWidth />
              <Text style={styles.footnote}>
                This is a local simulator. No money moves and no SMS is sent.
              </Text>
            </View>
          ) : null}

          {stage === 'otp' ? (
            <View>
              <Text style={styles.h1}>Enter the OTP</Text>
              <Text style={styles.lede}>An OTP has been sent to {masked}.</Text>
              <Card style={styles.card}>
                <SummaryRow label="Amount to pay" value={taka(amount)} tone="primary" />
                <SummaryRow label="Sent to" value={masked} />
              </Card>
              <Field
                label="6-digit OTP"
                value={otp}
                onChangeText={(next) => {
                  setOtp(next);
                  if (error) setError(null);
                }}
                placeholder="000000"
                keyboardType="number-pad"
                error={error}
                hint={`Simulator OTP: ${BKASH_DEMO.otp}`}
                accessibilityLabel="bKash OTP"
              />
              <Button title="Verify OTP" onPress={submitOtp} disabled={otp.length < 6} fullWidth />
              <View style={styles.gap} />
              <Button title="Send OTP again" variant="ghost" onPress={resendOtp} fullWidth />
              <Text style={styles.footnote}>Check the OTP shown above, then verify to move on to your PIN.</Text>
            </View>
          ) : null}

          {stage === 'pin' ? (
            <View>
              <Text style={styles.h1}>Enter your PIN</Text>
              <Text style={styles.lede}>Confirm with the 5-digit bKash PIN for {masked}.</Text>
              <Card style={styles.card}>
                <SummaryRow label="Amount to pay" value={taka(amount)} tone="primary" />
                <SummaryRow label="From" value={masked} />
              </Card>
              <Field
                label="bKash PIN"
                value={pin}
                onChangeText={(next) => {
                  setPin(next);
                  if (error) setError(null);
                }}
                placeholder="•••••"
                keyboardType="number-pad"
                secure
                error={error}
                hint={`Simulator PIN: ${BKASH_DEMO.pin}`}
                accessibilityLabel="bKash PIN"
              />
              <Button title="Pay now" onPress={submitPin} disabled={pin.length < 5} fullWidth />
              <Text style={styles.footnote}>Your PIN is never stored or transmitted by this simulator.</Text>
            </View>
          ) : null}

          {stage === 'processing' ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={bkashBrand.pink} />
              <Text style={[styles.h1, styles.centerText]}>Processing payment</Text>
              <Text style={[styles.lede, styles.centerText]}>Hang tight, we are confirming {taka(amount)} with bKash.</Text>
            </View>
          ) : null}

          {stage === 'success' && receipt ? (
            <View>
              <View style={styles.successHead}>
                <View style={styles.tick}>
                  <Text style={styles.tickGlyph}>✓</Text>
                </View>
                <Text style={styles.h1}>Payment Successful</Text>
              </View>
              <Card style={styles.card}>
                <SummaryRow label="Amount" value={taka(amount)} tone="primary" />
                <SummaryRow label="Paid to" value={merchant} />
                <SummaryRow label="From" value={masked} />
                <SummaryRow label="TrxID" value={receipt.reference} />
                <SummaryRow label="Time" value={formatDateTime(receipt.paidAt)} />
              </Card>
              <Text style={styles.footnote}>
                Saved on this device as a local payment record. Reference {receipt.reference}.
              </Text>
              <View style={styles.gap} />
              <Button title="View order" onPress={finish} fullWidth />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  brandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: bkashBrand.pink,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  brandWord: { color: bkashBrand.pinkSoft, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  brandSub: { color: bkashBrand.pinkSoft, fontSize: 12, marginTop: 2 },
  brandCancel: { color: bkashBrand.pinkSoft, fontSize: 14, fontWeight: '700' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  h1: { ...type.h1, color: colors.text },
  lede: { ...type.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.lg, ...makeShadow(1) },
  gap: { height: spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  centerText: { textAlign: 'center' },
  successHead: { alignItems: 'center', marginBottom: spacing.lg },
  tick: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  tickGlyph: { color: colors.success, fontSize: 32, fontWeight: '700' },
  footnote: { ...type.caption, textAlign: 'center', marginTop: spacing.md },
  pressed: { opacity: 0.7 },
});