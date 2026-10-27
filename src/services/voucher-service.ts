import { getContainer } from '@/infrastructure/container';
import type { Voucher, VoucherType } from '@/domain/types';
import type { SellerGroupView } from './pricing-service';
import { evaluateVoucherQuotes, voucherDisplayValue } from '@shared/voucher-rules';
import { vantaApi, type EligibleVoucherQuoteDto } from '@/api/vanta-api';
import { ApiError } from '@/api/api-client';
import { removeVoucher, upsertVoucher } from '@/api/remote-seller';

export interface VoucherQuote {
  voucher: Voucher;
  discount: number;
  valid: boolean;
  reason?: string;
}

export interface SellerVoucherInput {
  code: string;
  title: string;
  type: VoucherType;
  discountValue: number;
  minimumOrder: number;
  maximumDiscount?: number;
  startAt: string;
  expiry: string;
  usageLimit?: number;
  perUserLimit?: number;
  categoryId?: string;
  productIds?: string[];
  active: boolean;
  description?: string;
}

export type VoucherFieldError =
  | 'code'
  | 'title'
  | 'type'
  | 'discountValue'
  | 'minimumOrder'
  | 'maximumDiscount'
  | 'startAt'
  | 'expiry'
  | 'usageLimit'
  | 'perUserLimit'
  | 'ownership';

export class VoucherValidationError extends Error {
  readonly errors: Partial<Record<VoucherFieldError, string>>;
  constructor(errors: Partial<Record<VoucherFieldError, string>>) {
    super(Object.values(errors)[0] ?? 'This voucher needs attention.');
    this.name = 'VoucherValidationError';
    this.errors = errors;
  }
}

export interface SellerVoucherView {
  voucher: Voucher;
  storeName: string;
  state: 'live' | 'scheduled' | 'expired' | 'exhausted' | 'inactive';
  discountLabel: string;
  usedByPercent: number;
  problems: string[];
}

function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

const VOUCHER_FIELDS: VoucherFieldError[] = [
  'code',
  'title',
  'type',
  'discountValue',
  'minimumOrder',
  'maximumDiscount',
  'startAt',
  'expiry',
  'usageLimit',
  'perUserLimit',
];

/**
 * Rebuilds the device's field-error map from a server `422`. `code`/`type` only
 * ever appear on create; the server never accepts `scope`/`sellerId`, so any
 * field that is not part of the form is surfaced as an ownership problem rather
 * than dropped.
 */
function voucherErrorFrom(error: unknown): Error {
  if (error instanceof ApiError && error.code === 'validation_failed' && error.fields.length > 0) {
    const errors: Partial<Record<VoucherFieldError, string>> = {};
    for (const { field, message } of error.fields) {
      const key = (VOUCHER_FIELDS as readonly string[]).includes(field)
        ? (field as VoucherFieldError)
        : 'ownership';
      if (!errors[key]) errors[key] = message;
    }
    if (Object.keys(errors).length > 0) return new VoucherValidationError(errors);
    return new Error(error.message);
  }
  return error instanceof Error ? error : new Error('The promotion could not be saved.');
}

function serverVoucherBody(input: SellerVoucherInput, includeCodeAndType: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    discountValue: input.discountValue,
    minimumOrder: input.minimumOrder,
    maximumDiscount: input.maximumDiscount ?? null,
    startAt: input.startAt,
    expiry: input.expiry,
    usageLimit: input.usageLimit ?? null,
    perUserLimit: input.perUserLimit ?? null,
    categoryId: input.categoryId ?? null,
    productIds: input.productIds ?? [],
    active: input.active,
    description: input.description?.trim() ?? '',
  };
  if (includeCodeAndType) {
    body.code = normaliseCode(input.code);
    body.type = input.type;
  }
  return body;
}

function discountLabel(voucher: Voucher): string {
  if (voucher.type === 'percentage') {
    return voucher.maximumDiscount
      ? `${voucher.discountValue}% off, up to ${voucher.maximumDiscount}`
      : `${voucher.discountValue}% off`;
  }
  if (voucher.type === 'fixed') return `${voucher.discountValue} off`;
  return 'Free delivery';
}

export class VoucherService {
  listActive(): Voucher[] {
    const now = Date.now();
    return getContainer()
      .repositories.vouchers.list()
      .filter((v) => v.active && new Date(v.startAt).getTime() <= now && new Date(v.expiry).getTime() >= now);
  }

  getByCode(code: string): Voucher | undefined {
    return getContainer().repositories.vouchers.getByCode(code);
  }

  eligibleForCart(userId: string, groups: SellerGroupView[], subtotal: number): VoucherQuote[] {
    const now = Date.now();
    const { repositories } = getContainer();
    const voucherGroups = groups.map((group) => ({
      sellerId: group.sellerId,
      subtotal: group.subtotal,
      shippingFee: group.shippingFee,
      items: group.items.map((line) => ({
        selected: line.selected,
        sellerId: line.cart.sellerId,
        productId: line.product.id,
        categoryId: line.product.categoryId,
      })),
    }));
    return evaluateVoucherQuotes(repositories.vouchers.list(), voucherGroups, subtotal, userId, now);
  }

  /**
   * Remote-mode eligibility: the server owns which codes apply to this cart and
   * what they are worth, so the cart and vouchers screens read these quotes
   * instead of evaluating the (empty) device voucher repository. Throws the
   * `ApiError` so the caller can surface a load failure rather than showing no
   * vouchers as if the cart simply had none.
   */
  async eligibleForCartRemote(): Promise<VoucherQuote[]> {
    const { quotes } = await vantaApi.eligibleVouchers();
    return quotes.map((dto) => this.mapRemoteQuote(dto));
  }

  private mapRemoteQuote(dto: EligibleVoucherQuoteDto): VoucherQuote {
    const stamp = new Date().toISOString();
    const voucher: Voucher = {
      id: dto.id,
      code: dto.code,
      title: dto.title,
      type: dto.type,
      discountValue: dto.discountValue,
      minimumOrder: dto.minimumOrder,
      maximumDiscount: dto.maximumDiscount ?? undefined,
      scope: dto.scope,
      sellerId: dto.sellerId ?? undefined,
      categoryId: dto.categoryId ?? undefined,
      productIds: dto.productIds ?? [],
      startAt: stamp,
      expiry: dto.expiry,
      usageLimit: undefined,
      usageCount: 0,
      perUserLimit: undefined,
      perUserUsed: {},
      active: true,
      description: dto.description || undefined,
      createdAt: stamp,
      updatedAt: stamp,
    };
    return { voucher, discount: dto.discount, valid: dto.valid, reason: dto.reason ?? undefined };
  }

  discountValue(voucher: Voucher, groups: SellerGroupView[], subtotal: number): number {
    return voucherDisplayValue(
      voucher,
      groups.map((group) => ({
        sellerId: group.sellerId,
        subtotal: group.subtotal,
        shippingFee: group.shippingFee,
        freeShipping: group.freeShipping,
      })),
      subtotal,
    );
  }

  markUsed(voucher: Voucher, userId: string): void {
    const { repositories } = getContainer();
    const perUserUsed = { ...voucher.perUserUsed };
    if (userId) {
      perUserUsed[userId] = (perUserUsed[userId] ?? 0) + 1;
    }
    repositories.vouchers.update(voucher.id, {
      usageCount: voucher.usageCount + 1,
      perUserUsed,
      updatedAt: new Date().toISOString(),
    });
  }

  // ---------- Seller promotion management (M6-B) ----------

  private sellerVoucher(sellerId: string, voucherId: string): Voucher {
    const voucher = getContainer().repositories.vouchers.getById(voucherId);
    if (!voucher || voucher.scope !== 'seller' || voucher.sellerId !== sellerId) {
      throw new Error('Voucher not found.');
    }
    return voucher;
  }

  listForSeller(sellerId: string): SellerVoucherView[] {
    const { repositories } = getContainer();
    const now = Date.now();
    const storeName = repositories.stores.getBySellerId(sellerId)?.name ?? 'Your store';
    return repositories.vouchers
      .list()
      .filter((voucher) => voucher.scope === 'seller' && voucher.sellerId === sellerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((voucher) => this.toSellerView(voucher, storeName, now));
  }

  getForSeller(sellerId: string, voucherId: string): Voucher {
    return this.sellerVoucher(sellerId, voucherId);
  }

  async createForSeller(_sellerId: string, input: SellerVoucherInput): Promise<Voucher> {
    try {
      const { voucher } = await vantaApi.createSellerVoucher(serverVoucherBody(input, true));
      return upsertVoucher(voucher);
    } catch (error) {
      throw voucherErrorFrom(error);
    }
  }

  async updateForSeller(_sellerId: string, voucherId: string, input: SellerVoucherInput): Promise<Voucher> {
    try {
      const { voucher } = await vantaApi.updateSellerVoucher(voucherId, serverVoucherBody(input, false));
      return upsertVoucher(voucher);
    } catch (error) {
      throw voucherErrorFrom(error);
    }
  }

  async setActiveForSeller(_sellerId: string, voucherId: string, active: boolean): Promise<Voucher> {
    try {
      const { voucher } = await vantaApi.updateSellerVoucher(voucherId, { active });
      return upsertVoucher(voucher);
    } catch (error) {
      throw voucherErrorFrom(error);
    }
  }

  /** Archive-style delete: the voucher stops being usable and keeps its usage history. */
  async removeForSeller(_sellerId: string, voucherId: string): Promise<void> {
    try {
      const result = await vantaApi.deleteSellerVoucher(voucherId);
      if ('deleted' in result && result.deleted) removeVoucher(voucherId);
      else upsertVoucher((result as { voucher: Parameters<typeof upsertVoucher>[0] }).voucher);
    } catch (error) {
      throw voucherErrorFrom(error);
    }
  }

  private toSellerView(voucher: Voucher, storeName: string, now: number): SellerVoucherView {
    const expired = new Date(voucher.expiry).getTime() < now;
    const scheduled = new Date(voucher.startAt).getTime() > now;
    const exhausted = voucher.usageLimit !== undefined && voucher.usageCount >= voucher.usageLimit;
    const state: SellerVoucherView['state'] = !voucher.active
      ? 'inactive'
      : expired
        ? 'expired'
        : exhausted
          ? 'exhausted'
          : scheduled
            ? 'scheduled'
            : 'live';
    const problems: string[] = [];
    if (!voucher.active) problems.push('Disabled — customers cannot apply it.');
    if (expired) problems.push('Expired.');
    if (scheduled) problems.push('Starts later.');
    if (exhausted) problems.push('Usage limit reached.');
    if (voucher.minimumOrder > 0) problems.push(`Needs a ${voucher.minimumOrder} minimum.`);
    if (voucher.productIds?.length) problems.push(`Limited to ${voucher.productIds.length} listing(s).`);
    if (voucher.categoryId) problems.push('Limited to one category.');
    return {
      voucher,
      storeName,
      state,
      discountLabel: discountLabel(voucher),
      usedByPercent:
        voucher.usageLimit && voucher.usageLimit > 0
          ? Math.min(100, Math.round((voucher.usageCount / voucher.usageLimit) * 100))
          : 0,
      problems,
    };
  }
}

export const voucherService = new VoucherService();
