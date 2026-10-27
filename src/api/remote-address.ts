/**
 * Remote address bridge (M15-B).
 *
 * The server owns the address book, but the address screens and the checkout flow
 * read it synchronously. This module maps the server's `AddressDto` onto the
 * device `Address` entity so the existing reads keep working against an
 * in-memory mirror that `AddressService` maintains.
 *
 * No state is invented here: every field comes from an `/addresses` response. The
 * mapper widens the server's nullable `instructions` (it serialises `null`, not
 * `undefined`) to match the domain type.
 */
import type { Address } from '@/domain/types';

export interface AddressDto {
  id: string;
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  instructions: string | null;
  isDefault: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export function mapAddress(dto: AddressDto): Address {
  const stamp = dto.createdAt ?? dto.updatedAt ?? new Date().toISOString();
  return {
    id: dto.id,
    userId: dto.userId,
    label: dto.label || 'Address',
    recipientName: dto.recipientName,
    phone: dto.phone,
    division: dto.division,
    district: dto.district,
    area: dto.area,
    addressLine: dto.addressLine,
    postalCode: dto.postalCode,
    instructions: dto.instructions ?? undefined,
    isDefault: dto.isDefault,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}
