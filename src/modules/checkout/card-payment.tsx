import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Field, taka } from '@/components/ui';
import { SummaryRow } from '@/modules/checkout/checkout-ui';
import { CARD_DEMO, cardService, type CardSession } from '@/services/card-service';
import { cardBrand, colors, makeShadow, radius, spacing, type } from '@/theme/tokens';
import { formatDateTime } from '@/utils/time';

/**
 * A local, in-app stand-in for a card processor's payment screen. It is
 * presented as a dedicated sheet so the customer sees a real card-details and
 * verification-code checkout, but nothing leaves the device. `onSuccess` hands
 * the caller a local `TRX-VANTA-CARD-...` reference which the order service
 * records on the existing payment transaction.
 *
 * The processor is generic on purpose: this is not any one bank's authentication
 * and the PAN/CVV are validated locally and then discarded.
 */
type Stage = 'details' | 'otp' | 'processing' | 'success';

const PROCESSING_MS = 1400;

/** Shows a BD mobile as 017*****678 the way an OTP notice would. */
function maskPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 6) return 'your registered mobile number';
  return `${digits.slice(0, 3)}*****${digits.slice(-3)}`;
}

/** Groups a card number into fours as it is typed. */
function formatCardNumber(raw: string): string {
  return raw
    .replace(/[^\d]/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ')
    .trim();
}

/** Keeps an MM/YY expiry as the customer types it. */
function formatExpiry(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function CardPaymentSheet({
  visible,
  amount,
  stores,
  phone,
  onCancel,
  onSuccess,
}: {
  visible: boolean;
  amount: number;
  /** Names of the stores actually being paid, taken from the live checkout. */
  stores: string[];
  /** Mobile number from the live checkout address, used for the OTP notice. */
  phone: string;
  onCancel: () => void;
  onSuccess: (receipt: { reference: string; paidAt: string }) => void;
}): React.JSX.Element {
  const [stage, setStage] = React.useState<Stage>('details');
  const [cardholder, setCardholder] = React.useState('');
  const [number, setNumber] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  const [cvv, setCvv] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [session, setSession] = React.useState<CardSession | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [receipt, setReceipt] = React.useState<{ reference: string; paidAt: string } | null>(null);
  const successSent = React.useRef(false);

  // Cancel/close is a no-op while the payment is mid-flight or already
  // successful, so the customer cannot abandon a receipt that is being banked.
  const close = React.useCallback(() => {
    if (stage === 'processing' || stage === 'success') return;
    if (session) cardService.cancel(session);
    setSession(null);
    setError(null);
    onCancel();
  }, [onCancel, session, stage]);

  const submitDetails = (): void => {
    const result = cardService.start({ cardholder, number, expiry, cvv });
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
    const verified = cardService.verifyOtp(session, otp);
    if (!verified.ok) {
      setError(verified.message);
      return;
    }
    setError(null);
    // The card itself is already validated, so confirming straight after the
    // verification code is the whole remaining gate.
    const confirmed = cardService.confirm(session);
    if (!confirmed.ok) {
      setError(confirmed.message);
      return;
    }
    setReceipt(confirmed.value);
    setStage('processing');
  };

  // The processing beat is deliberate: a card payment is never instant, and
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

  const busy = stage === 'processing' || stage === 'success';
  const masked = session?.masked ?? '';
  const network = session?.network;
  // A card payment is made to one merchant, so a multi-store cart is shown as
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
            <Text style={styles.brandWord}>Card payment</Text>
            <Text style={styles.brandSub}>Secure checkout</Text>
          </View>
          {!busy ? (
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Cancel card payment"
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.brandCancel}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {stage === 'details' ? (
            <View>
              <Text style={styles.h1}>Enter your card details</Text>
              <Text style={styles.lede}>We will verify the card, then confirm this payment.</Text>
              <Card style={styles.card}>
                <SummaryRow label="Amount to pay" value={taka(amount)} tone="primary" />
                <SummaryRow label="Payment to" value={merchant} />
              </Card>
              <Field
                label="Name on card"
                value={cardholder}
                onChangeText={(next) => {
                  setCardholder(next);
                  if (error) setError(null);
                }}
                placeholder="VANTA TEST"
                autoCapitalize="characters"
                hint={`Simulator name: ${CARD_DEMO.cardholder}`}
                accessibilityLabel="Cardholder name"
              />
              <View style={styles.gap} />
              <Field
                label="Card number"
                value={number}
                onChangeText={(next) => {
                  setNumber(formatCardNumber(next));
                  if (error) setError(null);
                }}
                placeholder="0000 0000 0000 0000"
                keyboardType="number-pad"
                hint={`Simulator card: ${CARD_DEMO.number.replace(/(\d{4})(?=\d)/g, '$1 ')}`}
                accessibilityLabel="Card number"
              />
              <View style={styles.gap} />
              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <Field
                    label="Expiry"
                    value={expiry}
                    onChangeText={(next) => {
                      setExpiry(formatExpiry(next));
                      if (error) setError(null);
                    }}
                    placeholder="MM/YY"
                    keyboardType="number-pad"
                    hint={`Simulator: ${CARD_DEMO.expiry}`}
                    accessibilityLabel="Card expiry"
                  />
                </View>
                <View style={styles.rowGap} />
                <View style={styles.rowItem}>
                  <Field
                    label="CVV"
                    value={cvv}
                    onChangeText={(next) => {
                      setCvv(next.replace(/[^\d]/g, '').slice(0, 4));
                      if (error) setError(null);
                    }}
                    placeholder="000"
                    keyboardType="number-pad"
                    secure
                    hint={`Simulator: ${CARD_DEMO.cvv}`}
                    accessibilityLabel="Card CVV"
                  />
                </View>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.gap} />
              <Button title="Continue to verification" onPress={submitDetails} fullWidth />
              <Text style={styles.footnote}>
                This is a local simulator. No card is charged and no gateway is contacted.
              </Text>
            </View>
          ) : null}

          {stage === 'otp' ? (
            <View>
              <Text style={styles.h1}>Enter the verification code</Text>
              <Text style={styles.lede}>Verification code sent to {maskPhone(phone)}.</Text>
              <Card style={styles.card}>
                <SummaryRow label="Amount to pay" value={taka(amount)} tone="primary" />
                <SummaryRow label="Card" value={network ? `${network} ${masked}` : masked} />
              </Card>
              <Field
                label="6-digit verification code"
                value={otp}
                onChangeText={(next) => {
                  setOtp(next);
                  if (error) setError(null);
                }}
                placeholder="000000"
                keyboardType="number-pad"
                error={error}
                hint={`Simulator code: ${CARD_DEMO.otp}`}
                accessibilityLabel="Card verification code"
              />
              <Button title="Verify and pay" onPress={submitOtp} disabled={otp.length < 6} fullWidth />
              <Text style={styles.footnote}>Check the code shown above, then verify to complete the payment.</Text>
            </View>
          ) : null}

          {stage === 'processing' ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={cardBrand.accent} />
              <Text style={[styles.h1, styles.centerText]}>Processing payment</Text>
              <Text style={[styles.lede, styles.centerText]}>Hang tight, we are confirming {taka(amount)}.</Text>
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
                <SummaryRow label="Card" value={network ? `${network} ${masked}` : masked} />
                <SummaryRow label="Reference" value={receipt.reference} />
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
    backgroundColor: cardBrand.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  brandWord: { color: cardBrand.accentSoft, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  brandSub: { color: cardBrand.accentSoft, fontSize: 12, marginTop: 2 },
  brandCancel: { color: cardBrand.accentSoft, fontSize: 14, fontWeight: '700' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  h1: { ...type.h1, color: colors.text },
  lede: { ...type.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  card: { marginBottom: spacing.lg, ...makeShadow(1) },
  row: { flexDirection: 'row' },
  rowItem: { flex: 1 },
  rowGap: { width: spacing.md },
  gap: { height: spacing.md },
  error: { ...type.caption, color: colors.danger, marginBottom: spacing.sm },
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