/**
 * Remote customer-order bridge (M15-B).
 *
 * The server owns orders. The customer screens (orders list, order detail,
 * confirmation) read the device repositories synchronously, so this module maps
 * the server's order/payment DTOs onto the domain entities and writes them into
 * the local mirror. `OrderService` primes that mirror from `GET /orders` at boot
 * and refreshes it after a mutation, so the synchronous reads keep working.
 *
 * Every field comes from a server response — nothing is computed from the cart.
 */
import type {
  Address,
  DeliveryMethodId,
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
} from '@/domain/types';
import { getContainer } from '@/infrastructure/container';
import {
  mapSellerOrderView,
  upsertReturn,
  type AddressDto as OrderAddressDto,
  type ReturnDto,
  type SellerOrderViewDto,
} from './remote-seller';

function upsert(key: 'orders' | 'sellerOrders' | 'payments', entity: object & { id: string }): void {
  getContainer().db.upsert(key, entity as { id: string } & Record<string, unknown>);
}

export interface OrderPaymentDto {
  id: string;
  orderId: string;
  method: string;
  amount: number;
  status: string;
  reference: string;
  paidAt: string | null;
  refundedAt: string | null;
  refundedAmount: number;
  createdAt: string | null;
}

export interface OrderDto {
  id: string;
  orderCode: string;
  customerId: string;
  status: string;
  sellerOrderIds: string[];
  subtotal: number;
  shippingTotal: number;
  vouchersDiscount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  deliveryMethod: string;
  shippingAddress: OrderAddressDto | null;
  address?: OrderAddressDto | null;
  voucherCodes: string[];
  placedAt: string | null;
  cancelledAt: string | null;
  deliveredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** A seller order exactly as `toSellerOrderDto` returns it (no parent summary). */
export type SellerOrderDto = Omit<SellerOrderViewDto, 'order'>;

/**
 * Mirror the customer's return requests from a `/returns`-family response.
 *
 * The server owns returns; the customer detail/history screens read them
 * synchronously from the device repositories, so a return has to be written
 * into the mirror before those screens can show it. Nothing here is invented —
 * each row is a server DTO.
 */
export function upsertReturns(dtos: ReturnDto[]): void {
  for (const dto of dtos) upsertReturn(dto);
}

export interface OrderReceiptDto {
  order: OrderDto;
  sellerOrders: SellerOrderDto[];
  payment: OrderPaymentDto | null;
}

export interface OrderDetailDto {
  order: OrderDto;
  sellerOrders: SellerOrderDto[];
  payment: OrderPaymentDto[];
}

function mapOrderAddress(dto: OrderAddressDto | null | undefined, owner: string): Address {
  const stamp = new Date().toISOString();
  return {
    id: `addr_${owner}`,
    userId: '',
    label: dto?.label ?? '',
    recipientName: dto?.recipientName ?? '',
    phone: dto?.phone ?? '',
    division: dto?.division ?? '',
    district: dto?.district ?? '',
    area: dto?.area ?? '',
    addressLine: dto?.addressLine ?? '',
    postalCode: dto?.postalCode ?? '',
    instructions: dto?.instructions ?? undefined,
    isDefault: dto?.isDefault === true,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function mapOrder(dto: OrderDto): Order {
  const stamp = dto.createdAt ?? dto.placedAt ?? new Date().toISOString();
  return {
    id: dto.id,
    customerId: dto.customerId,
    orderCode: dto.orderCode,
    status: dto.status as OrderStatus,
    sellerOrderIds: [...(dto.sellerOrderIds ?? [])],
    subtotal: dto.subtotal,
    shippingTotal: dto.shippingTotal,
    vouchersDiscount: dto.vouchersDiscount,
    total: dto.total,
    paymentMethod: (dto.paymentMethod || 'cod') as PaymentMethod,
    paymentStatus: (dto.paymentStatus || 'pending') as PaymentStatus,
    deliveryMethod: (dto.deliveryMethod || 'standard') as DeliveryMethodId,
    shippingAddress: mapOrderAddress(dto.shippingAddress ?? dto.address ?? null, dto.id),
    voucherCodes: [...(dto.voucherCodes ?? [])],
    placedAt: dto.placedAt ?? stamp,
    cancelledAt: dto.cancelledAt ?? undefined,
    deliveredAt: dto.deliveredAt ?? undefined,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

export function mapOrderPayment(dto: OrderPaymentDto): PaymentTransaction {
  const stamp = dto.createdAt ?? dto.paidAt ?? new Date().toISOString();
  return {
    id: dto.id,
    orderId: dto.orderId,
    userId: '',
    method: (dto.method || 'cod') as PaymentMethod,
    amount: dto.amount,
    status: (dto.status || 'pending') as PaymentStatus,
    reference: dto.reference || undefined,
    paidAt: dto.paidAt ?? undefined,
    refundedAt: dto.refundedAt ?? undefined,
    refundedAmount: dto.refundedAmount || undefined,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * Mirror one order and its splits. The parent order is written LAST so the
 * synthetic single-split summary `mapSellerOrderView` produces for the seller
 * mirror never clobbers the real multi-seller order.
 */
export function upsertOrder(orderDto: OrderDto): Order {
  const order = mapOrder(orderDto);
  upsert('orders', order);
  return order;
}

export function upsertReceipt(receipt: OrderReceiptDto | OrderDetailDto): Order {
  const order = mapOrder(receipt.order);
  for (const sellerOrderDto of receipt.sellerOrders) {
    const { sellerOrder } = mapSellerOrderView({ ...sellerOrderDto, order: receipt.order });
    upsert('sellerOrders', sellerOrder);
  }
  // Parent last: it must not be a single-seller summary.
  upsert('orders', order);
  const payments = Array.isArray(receipt.payment) ? receipt.payment : receipt.payment ? [receipt.payment] : [];
  for (const payment of payments) {
    upsert('payments', mapOrderPayment(payment));
  }
  return order;
}
