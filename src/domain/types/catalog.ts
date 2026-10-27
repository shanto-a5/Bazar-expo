import type { BaseEntity } from './entity';

export interface Category extends BaseEntity {
  name: string;
  icon: string;
  image: string;
  parentId: string | null;
  order: number;
}

export type ProductStatus =
  | 'draft'
  | 'pending'
  | 'active'
  | 'paused'
  | 'out_of_stock'
  | 'archived';

export interface ProductVariant extends BaseEntity {
  productId: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice?: number;
  stock: number;
  image?: string;
}

export interface Product extends BaseEntity {
  sellerId: string;
  storeId: string;
  name: string;
  brand: string;
  categoryId: string;
  subcategoryId: string | null;
  description: string;
  highlights: string[];
  images: string[];
  video?: { placeholder?: string; uri?: string } | null;
  regularPrice: number;
  salePrice?: number;
  costPrice?: number;
  sku: string;
  stock: number;
  lowStockThreshold: number;
  variants: ProductVariant[];
  hasVariants: boolean;
  status: ProductStatus;
  publishedAt?: string;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  viewCount: number;
  isNewArrival?: boolean;
}

export type SellerType = 'individual' | 'business';
/**
 * M8: `rejected` was missing here even though the server has always been able to
 * return it. Without it the status view had no way to say "your application was
 * turned down" and would have rendered the value as an unknown state.
 */
export type SellerStatus = 'pending' | 'active' | 'rejected' | 'suspended';

export interface BankInformation {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch?: string;
}

export interface SellerAgreement {
  marketplaceTerms: boolean;
  sellerPolicies: boolean;
  productAuthenticity: boolean;
  fulfillmentResponsibility: boolean;
}

export interface SellerProfile extends BaseEntity {
  userId: string;
  storeId: string;
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  sellerType: SellerType;
  entityName?: string;
  pickupDivision: string;
  pickupDistrict: string;
  pickupArea: string;
  pickupAddressLine: string;
  returnDivision: string;
  returnDistrict: string;
  returnArea: string;
  returnAddressLine: string;
  bank: BankInformation;
  agreement: SellerAgreement;
  status: SellerStatus;
}

export interface Store extends BaseEntity {
  sellerId: string;
  name: string;
  description: string;
  logo: string;
  banner: string;
  status: 'active' | 'paused';
  ratingAvg: number;
  ratingCount: number;
  responseRate: number;
  responseTimeMinutes: number;
  productCount: number;
  followerCount: number;
  shippingFee: number;
  freeShippingThreshold: number;
  deliveryEstimateDays: { min: number; max: number };
  location: string;
  verified: boolean;
}