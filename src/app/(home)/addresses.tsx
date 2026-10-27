import * as React from 'react';

import { Text, View } from 'react-native';


import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader } from '@/components/ui';
import {
  AddressFormFields,
  addressFormSummary,
  EMPTY_ADDRESS_FORM,
  validateAddressForm,
  type AddressFormErrors,
  type AddressFormValue,
} from '@/modules/account/address-form';
import { useSession } from '@/modules/session/session-context';
import { SignInGate } from '@/modules/session/route-guard';
import { EmptyState, Pill } from '@/modules/orders/order-ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { addressService } from '@/services/address-service';
import { colors, spacing, type } from '@/theme/tokens';

type EditorState = { mode: 'create' } | { mode: 'edit'; id: string } | null;

export default function AddressesScreen(): React.JSX.Element {
  const { user } = useSession();
  useFocusRefresh();
  const [editor, setEditor] = React.useState<EditorState>(null);
  const [form, setForm] = React.useState<AddressFormValue>(EMPTY_ADDRESS_FORM);
  const [errors, setErrors] = React.useState<AddressFormErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ text: string; kind: 'success' | 'error' } | null>(null);

  const userId = user?.id ?? '';
  const addresses = userId ? addressService.list(userId) : [];

  if (!user) {
    return <SignInGate title="Addresses" message="Sign in to save delivery addresses and check out faster." fallback="/account" />;
  }

  const openCreate = (): void => {
    setForm(EMPTY_ADDRESS_FORM);
    setErrors({});
    setFormError(null);
    setEditor({ mode: 'create' });
  };

  const openEdit = (id: string): void => {
    const address = addressService.get(userId, id);
    if (!address) return;
    setForm({
      label: address.label,
      recipientName: address.recipientName,
      phone: address.phone,
      division: address.division,
      district: address.district,
      area: address.area,
      addressLine: address.addressLine,
      postalCode: address.postalCode,
      instructions: address.instructions ?? '',
      makeDefault: address.isDefault,
    });
    setErrors({});
    setFormError(null);
    setEditor({ mode: 'edit', id });
  };

  const close = (): void => {
    setEditor(null);
    setForm(EMPTY_ADDRESS_FORM);
    setErrors({});
    setFormError(null);
  };

  const update = (key: keyof AddressFormValue, value: string | boolean): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (): Promise<void> => {
    const found = validateAddressForm(form);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setFormError(null);
    try {
      if (editor?.mode === 'edit') {
        await addressService.update(userId, editor.id, {
          label: form.label,
          recipientName: form.recipientName,
          phone: form.phone,
          division: form.division,
          district: form.district,
          area: form.area,
          addressLine: form.addressLine,
          postalCode: form.postalCode,
          instructions: form.instructions,
          isDefault: form.makeDefault,
        });
        setNotice({ text: 'Address updated.', kind: 'success' });
      } else {
        await addressService.add(userId, {
          label: form.label,
          recipientName: form.recipientName,
          phone: form.phone,
          division: form.division,
          district: form.district,
          area: form.area,
          addressLine: form.addressLine,
          postalCode: form.postalCode,
          instructions: form.instructions,
          isDefault: form.makeDefault,
        });
        setNotice({ text: 'Address saved. It is now available in checkout.', kind: 'success' });
      }
      close();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save this address.');
    }
  };

  const makeDefault = async (id: string): Promise<void> => {
    try {
      await addressService.setDefault(userId, id);
      setNotice({ text: 'Default delivery address updated.', kind: 'success' });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Unable to update the default address.', kind: 'error' });
    }
  };

  const remove = async (id: string, label: string): Promise<void> => {
    try {
      await addressService.remove(userId, id);
      setNotice({ text: `${label} removed.`, kind: 'success' });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Unable to remove this address.', kind: 'error' });
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/account" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md }}>Address book</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        Saved to your account and offered at checkout.
      </Text>

      {notice ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ ...type.body, color: notice.kind === 'error' ? colors.danger : colors.success }}>{notice.text}</Text>
        </View>
      ) : null}

      {addresses.length === 0 && !editor ? (
        <EmptyState
          title="No saved addresses"
          message="Add the addresses you deliver to and mark one as your default."
          actionLabel="Add address"
          onAction={openCreate}
        />
      ) : null}

      {addresses.map((address) => (
        <Card key={address.id} style={{ marginBottom: spacing.md }}>
          <View style={styles.header}>
            <Text style={{ ...type.h3, color: colors.text, flex: 1 }} numberOfLines={1}>
              {address.label}
            </Text>
            {address.isDefault ? <Pill label="Default" tone="success" /> : null}
          </View>
          <Text style={{ ...type.body, color: colors.text }}>{address.recipientName}</Text>
          <Text style={{ ...type.caption }}>{address.phone}</Text>
          <Text style={{ ...type.body, marginTop: spacing.xs }}>{address.addressLine}</Text>
          <Text style={{ ...type.caption }}>{addressFormSummary(address)}</Text>
          {address.postalCode ? <Text style={{ ...type.caption }}>{`Postal code ${address.postalCode}`}</Text> : null}
          {address.instructions ? <Text style={{ ...type.caption }}>{address.instructions}</Text> : null}

          <View style={{ height: spacing.md }} />
          <View style={styles.actions}>
            <Button title="Edit" variant="secondary" onPress={() => openEdit(address.id)} />
            {!address.isDefault ? (
              <Button
                title="Make default"
                variant="ghost"
                onPress={() => void makeDefault(address.id)}
                accessibilityLabel={`Make ${address.label} the default address`}
              />
            ) : null}
            <Button
              title="Remove"
              variant="danger"
              onPress={() => void remove(address.id, address.label)}
              accessibilityLabel={`Remove ${address.label}`}
            />
          </View>
        </Card>
      ))}

      {editor ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <SectionHeader
            title={editor.mode === 'edit' ? 'Edit address' : 'New address'}
            caption="Required fields are marked after you save"
          />
          {formError ? (
            <Text style={{ ...type.body, color: colors.danger, marginBottom: spacing.sm }}>{formError}</Text>
          ) : null}
          <AddressFormFields value={form} errors={errors} onChange={update} />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="ghost" onPress={close} fullWidth />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Save address" onPress={() => void submit()} fullWidth />
            </View>
          </View>
        </Card>
      ) : (
        <Button title="Add new address" onPress={openCreate} fullWidth />
      )}
    </Screen>
  );
}

const styles = {
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, marginBottom: spacing.xs },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
};
