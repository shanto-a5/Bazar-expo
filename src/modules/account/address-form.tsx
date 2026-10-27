import * as React from 'react';

import { Pressable, Text, View } from 'react-native';

import { Field } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';

export interface AddressFormValue {
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  instructions: string;
  makeDefault: boolean;
}

export type AddressFormErrors = Partial<Record<keyof AddressFormValue, string>>;

export const EMPTY_ADDRESS_FORM: AddressFormValue = {
  label: '',
  recipientName: '',
  phone: '',
  division: '',
  district: '',
  area: '',
  addressLine: '',
  postalCode: '',
  instructions: '',
  makeDefault: false,
};

export function validateAddressForm(value: AddressFormValue & { latitude?: any; longitude?: any }): AddressFormErrors {
  const errors: AddressFormErrors = {};
  if (!(value.recipientName || '').trim()) errors.recipientName = 'Who should receive the order?';
  if ((value.phone || '').replace(/\D/g, '').length < 6) errors.phone = 'Enter a valid phone number';
  const lat = (value as any).latitude;
  const lng = (value as any).longitude;
  const hasValidGps =
    lat !== undefined &&
    lat !== null &&
    lat !== '' &&
    lng !== undefined &&
    lng !== null &&
    lng !== '' &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180;
  if (!hasValidGps) {
    if (!(value.division || '').trim()) errors.division = 'Division is required';
    if (!(value.district || '').trim()) errors.district = 'District is required';
    if (!(value.addressLine || '').trim()) errors.addressLine = 'Street address is required';
  }
  if ((value.postalCode || '').trim() && !/^\d{4}$/.test((value.postalCode || '').trim())) {
    errors.postalCode = 'Use a 4 digit postal code';
  }
  return errors;
}

export function addressFormSummary(value: { area: string; district: string; division: string }): string {
  return [value.area, value.district, value.division].filter(Boolean).join(', ');
}

export function AddressFormFields({
  value,
  errors,
  onChange,
}: {
  value: AddressFormValue;
  errors: AddressFormErrors;
  onChange: (key: keyof AddressFormValue, value: string | boolean) => void;
}): React.JSX.Element {
  return (
    <View>
      <Field
        value={value.label}
        onChangeText={(next) => onChange('label', next)}
        placeholder="Home"
        label="Label"
      />
      <Field
        value={value.recipientName}
        onChangeText={(next) => onChange('recipientName', next)}
        placeholder="Full name"
        label="Recipient name"
        error={errors.recipientName}
      />
      <Field
        value={value.phone}
        onChangeText={(next) => onChange('phone', next)}
        placeholder="01XXXXXXXXX"
        label="Phone"
        keyboardType="phone-pad"
        error={errors.phone}
      />
      <Field
        value={value.division}
        onChangeText={(next) => onChange('division', next)}
        placeholder="Dhaka"
        label="Division"
        error={errors.division}
      />
      <Field
        value={value.district}
        onChangeText={(next) => onChange('district', next)}
        placeholder="Dhaka"
        label="District"
        error={errors.district}
      />
      <Field value={value.area} onChangeText={(next) => onChange('area', next)} placeholder="Banani" label="Area" />
      <Field
        value={value.addressLine}
        onChangeText={(next) => onChange('addressLine', next)}
        placeholder="House 12, Road 7"
        label="Address line"
        error={errors.addressLine}
      />
      <Field
        value={value.postalCode}
        onChangeText={(next) => onChange('postalCode', next)}
        placeholder="1213"
        label="Postal code"
        keyboardType="number-pad"
        error={errors.postalCode}
      />
      <Field
        value={value.instructions}
        onChangeText={(next) => onChange('instructions', next)}
        placeholder="Call upon arrival"
        label="Delivery notes"
      />
      <Pressable
        onPress={() => onChange('makeDefault', !value.makeDefault)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value.makeDefault }}
        accessibilityLabel="Make this my default address"
        hitSlop={6}
      >
        <Text style={{ ...type.caption, color: colors.primary, fontWeight: '700' }}>
          {value.makeDefault ? 'Default address: yes' : 'Make this my default address'}
        </Text>
      </Pressable>
      <View style={{ height: spacing.md }} />
    </View>
  );
}
