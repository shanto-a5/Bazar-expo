import type { Address } from '@/domain/types';
import { vantaApi, type AddressPayload } from '@/api/vanta-api';
import { mapAddress } from '@/api/remote-address';

export interface AddressInput {
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  instructions?: string;
  isDefault?: boolean;
}

export type AddressField = keyof AddressInput;

function validate(input: AddressInput): Partial<Record<AddressField, string>> {
  const errors: Partial<Record<AddressField, string>> = {};
  if (!input.recipientName?.trim()) errors.recipientName = 'Who should receive the order?';
  if ((input.phone || '').replace(/\D/g, '').length < 6) errors.phone = 'Enter a valid phone number';
  const lat = (input as any).latitude;
  const lng = (input as any).longitude;
  const hasValidGps =
    lat !== undefined &&
    lat !== null &&
    lng !== undefined &&
    lng !== null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180;
  if (!hasValidGps) {
    if (!(input.division || '').trim()) errors.division = 'Division is required';
    if (!(input.district || '').trim()) errors.district = 'District is required';
    if (!(input.addressLine || '').trim()) errors.addressLine = 'Street address is required';
  }
  if ((input.postalCode || '').trim() && !/^\d{4}$/.test((input.postalCode || '').trim())) {
    errors.postalCode = 'Use a 4 digit postal code';
  }
  return errors;
}

function toPayload(input: AddressInput): AddressPayload {
  const lat = (input as any).latitude;
  const lng = (input as any).longitude;
  const hasLat = lat !== undefined && lat !== null && lat !== '' && Number.isFinite(Number(lat));
  const hasLng = lng !== undefined && lng !== null && lng !== '' && Number.isFinite(Number(lng));
  return {
    label: (input.label || '').trim() || 'Address',
    recipientName: (input.recipientName || '').trim(),
    phone: (input.phone || '').trim(),
    division: (input.division || '').trim(),
    district: (input.district || '').trim(),
    area: (input.area || '').trim(),
    addressLine: (input.addressLine || '').trim(),
    postalCode: (input.postalCode || '').trim(),
    instructions: input.instructions?.trim() || undefined,
    isDefault: input.isDefault,
    ...(hasLat && hasLng ? { latitude: Number(lat), longitude: Number(lng) } : {}),
  } as any;
}

// ------------------------------------------------------------------ remote
// The server owns the address book. AddressService keeps one in-memory copy per
// signed-in user so the existing synchronous reads keep working. Mutations are
// serialised per user and return the server's answer, so the screens can show
// success/failure honestly instead of guessing.
const REMOTE_ADDRESS_TTL_MS = 5_000;

interface RemoteAddressState {
  /** Tail of the per-user operation chain; every server call is appended here. */
  op: Promise<void>;
  inflight: boolean;
  loaded: boolean;
  updatedAt: number;
  addresses: Address[];
}

export class AddressService {
  private remote = new Map<string, RemoteAddressState>();
  private listeners = new Set<() => void>();

  private state(userId: string): RemoteAddressState {
    let state = this.remote.get(userId);
    if (!state) {
      state = { op: Promise.resolve(), inflight: false, loaded: false, updatedAt: 0, addresses: [] };
      this.remote.set(userId, state);
    }
    return state;
  }

  /** Re-render hook: the session context subscribes and bumps a revision. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Serialise one round trip per user; a failed call never poisons the chain. */
  private enqueue<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const state = this.state(userId);
    const run = state.op.then(task, task);
    state.op = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private applyOne(userId: string, address: Address): void {
    const state = this.state(userId);
    const others = state.addresses
      .filter((entry) => entry.id !== address.id)
      .map((entry) => (address.isDefault ? { ...entry, isDefault: false } : entry));
    const index = state.addresses.findIndex((entry) => entry.id === address.id);
    const next = [...others];
    next.splice(index === -1 ? next.length : index, 0, address);
    state.addresses = next;
    state.loaded = true;
    state.updatedAt = Date.now();
  }

  private replace(userId: string, addresses: Address[]): void {
    const state = this.state(userId);
    state.addresses = addresses;
    state.loaded = true;
    state.updatedAt = Date.now();
  }

  private fetchOnce(userId: string): Promise<void> {
    return this.enqueue(userId, async () => {
      const { addresses } = await vantaApi.addresses();
      this.replace(userId, addresses.map(mapAddress));
      this.notify();
    });
  }

  /**
   * Force a fresh server read. Called by the session context when a signed-in
   * user appears so the mirror reflects that account before the UI unlocks.
   */
  async hydrate(userId: string): Promise<void> {
    if (!userId) return;
    await this.enqueue(userId, async () => {
      const { addresses } = await vantaApi.addresses();
      this.replace(userId, addresses.map(mapAddress));
      this.notify();
    });
  }

  /**
   * Lazy read path behind every synchronous remote read: a book that has never
   * been fetched (or is older than the TTL) starts one GET; the read returns the
   * current copy and the applied response notifies subscribers so the consuming
   * screen re-renders with the server's answer.
   */
  private ensureLoaded(userId: string): void {
    const state = this.state(userId);
    if (state.inflight) return;
    const stale = !state.loaded || Date.now() - state.updatedAt > REMOTE_ADDRESS_TTL_MS;
    if (!stale) return;
    state.inflight = true;
    void this.enqueue(userId, async () => {
      const { addresses } = await vantaApi.addresses();
      this.replace(userId, addresses.map(mapAddress));
      this.notify();
    })
      .catch(() => undefined)
      .finally(() => {
        state.inflight = false;
      });
  }

  list(userId: string): Address[] {
    if (!userId) return [];
    this.ensureLoaded(userId);
    return this.state(userId).addresses;
  }

  /** Drops one account's in-memory address book. Called on sign-out. */
  resetUser(userId: string): void {
    this.remote.delete(userId);
  }

  getDefault(userId: string): Address | undefined {
    const addresses = this.list(userId);
    return addresses.find((a) => a.isDefault) ?? addresses[0];
  }

  /**
   * Address lookup by id. `userId` scopes the lookup to one owner so this can
   * never surface another account's address; in remote mode the cached states of
   * every signed-in account live in one map, so an unscoped scan would leak.
   * Callers that know the account should use `get(userId, id)` instead.
   */
  getById(id: string, userId?: string): Address | undefined {
    if (!userId) return undefined;
    return this.state(userId).addresses.find((entry) => entry.id === id);
  }

  get(userId: string, id: string): Address | undefined {
    if (!userId) return undefined;
    this.ensureLoaded(userId);
    return this.state(userId).addresses.find((entry) => entry.id === id);
  }

  count(userId: string): number {
    return this.list(userId).length;
  }

  async add(userId: string, input: AddressInput): Promise<Address> {
    const errors = validate(input);
    const first = Object.entries(errors)[0];
    if (first) throw new Error(first[1]);
    return this.enqueue(userId, async () => {
      const { address } = await vantaApi.createAddress(toPayload(input));
      const mapped = mapAddress(address);
      this.applyOne(userId, mapped);
      this.notify();
      return mapped;
    });
  }

  async update(userId: string, id: string, patch: Partial<AddressInput>): Promise<Address> {
    const address = this.get(userId, id);
    if (!address) throw new Error('Address not found.');
    const merged: AddressInput = {
      label: patch.label ?? address.label,
      recipientName: patch.recipientName ?? address.recipientName,
      phone: patch.phone ?? address.phone,
      division: patch.division ?? address.division,
      district: patch.district ?? address.district,
      area: patch.area ?? address.area,
      addressLine: patch.addressLine ?? address.addressLine,
      postalCode: patch.postalCode ?? address.postalCode,
      instructions: patch.instructions ?? address.instructions,
    };
    const errors = validate(merged);
    const first = Object.entries(errors)[0];
    if (first) throw new Error(first[1]);
    return this.enqueue(userId, async () => {
      const { address: updated } = await vantaApi.updateAddress(id, {
        ...toPayload(merged),
        isDefault: patch.isDefault ?? address.isDefault,
      });
      const mapped = mapAddress(updated);
      this.applyOne(userId, mapped);
      this.notify();
      return mapped;
    });
  }

  async setDefault(userId: string, id: string): Promise<void> {
    const address = this.get(userId, id);
    if (!address) throw new Error('Address not found.');
    await this.enqueue(userId, async () => {
      const { address: updated } = await vantaApi.setDefaultAddress(id);
      this.applyOne(userId, mapAddress(updated));
      this.notify();
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const address = this.get(userId, id);
    if (!address) throw new Error('Address not found.');
    await this.enqueue(userId, async () => {
      const { addresses } = await vantaApi.deleteAddress(id);
      this.replace(userId, addresses.map(mapAddress));
      this.notify();
    });
  }
}

export const addressService = new AddressService();
