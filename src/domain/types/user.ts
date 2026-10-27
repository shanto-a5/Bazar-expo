import type { BaseEntity } from './entity';

export type Role = 'customer' | 'seller';

export interface User extends BaseEntity {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  passwordSalt: string;
  avatar: string;
  /**
   * False only for a quick account whose owner has not chosen a password yet.
   * Optional so entities built before the field existed read as "has one".
   */
  hasPassword?: boolean;
  roles: Role[];
}

export interface Session extends BaseEntity {
  userId: string;
  token: string;
  expiresAt: string;
}

export interface Address extends BaseEntity {
  userId: string;
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  instructions?: string;
  isDefault: boolean;
}