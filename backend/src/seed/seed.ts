/**
 * Seed application (M7-O).
 *
 * Deterministic and idempotent: a document is written only when its id is absent,
 * and password hashes are only computed for accounts that do not exist yet (bcrypt
 * salts are random, so re-hashing an existing account would make every run differ).
 * Running the seed twice therefore leaves the datastore byte-identical, and
 * relationships (user → seller → store → product → order → review) are preserved
 * because ids are fixed.
 */
import * as bcrypt from 'bcryptjs';
import { config } from '../config/env';
import { SEED_ACCOUNTS, buildDataset, type SeedDataset, type SeedSummary } from './dataset';
import type { RepositoryBundle } from '../repositories/contracts';
import type { SellerProfileEntity, UserEntity } from '../domain/entities';

export type { SeedSummary };

async function insertUser(repos: RepositoryBundle, user: UserEntity, password: string): Promise<boolean> {
  const existing = await repos.users.findById(user.id);
  if (existing) return false;
  await repos.users.insert({ ...user, passwordHash: await bcrypt.hash(password, config.bcryptRounds) });
  return true;
}

export async function runSeed(repos: RepositoryBundle): Promise<SeedSummary> {
  const data: SeedDataset = await buildDataset(repos);
  let created = 0;
  let skipped = 0;

  const record = async (write: () => Promise<unknown>): Promise<void> => {
    await write();
    created += 1;
  };

  for (const category of data.categories) {
    if (await repos.categories.findById(category.id)) {
      skipped += 1;
      continue;
    }
    await record(() => repos.categories.insert(category));
  }

  for (const customer of data.customers) {
    const account = SEED_ACCOUNTS.customers.find((entry) => entry.id === customer.id);
    if (await insertUser(repos, customer, account?.password ?? 'VantaPass1!')) created += 1;
    else skipped += 1;
  }

  for (const sellerUser of data.sellerUsers) {
    const account = SEED_ACCOUNTS.sellers.find((entry) => entry.id === sellerUser.id);
    if (await insertUser(repos, sellerUser, account?.password ?? 'VantaPass1!')) created += 1;
    else skipped += 1;
  }

  for (const staffUser of data.staffUsers) {
    const account = SEED_ACCOUNTS.approvers.find((entry) => entry.id === staffUser.id);
    if (await insertUser(repos, staffUser, account?.password ?? 'VantaPass1!')) created += 1;
    else skipped += 1;
  }

  for (const profile of data.sellerProfiles) {
    const existing = (await repos.sellers.findById(profile.id)) as SellerProfileEntity | null;
    if (existing) {
      skipped += 1;
      continue;
    }
    await record(() => repos.sellers.insert(profile));
  }

  for (const store of data.stores) {
    if (await repos.stores.findById(store.id)) {
      skipped += 1;
      continue;
    }
    await record(() => repos.stores.insert(store));
  }

  for (const product of data.products) {
    if (await repos.products.findById(product.id)) {
      skipped += 1;
      continue;
    }
    await record(() => repos.products.insert(product));
  }

  for (const voucher of data.vouchers) {
    if (await repos.vouchers.findById(voucher.id)) {
      skipped += 1;
      continue;
    }
    await record(() => repos.vouchers.insert(voucher));
  }

  for (const address of data.addresses) {
    if (await repos.addresses.findById(address.id)) {
      skipped += 1;
      continue;
    }
    await record(() => repos.addresses.insert(address));
  }

  if (await repos.orders.findById(data.order.id)) {
    skipped += 1;
  } else {
    await record(async () => {
      for (const sellerOrder of data.sellerOrders) await repos.sellerOrders.insert(sellerOrder);
      await repos.orders.insert(data.order);
      await repos.payments.insert(data.payment);
    });
  }

  for (const review of data.reviews) {
    if (await repos.reviews.findById(review.id)) {
      skipped += 1;
      continue;
    }
    await record(() => repos.reviews.insert(review));
  }

  return {
    categories: data.categories.length,
    users: data.customers.length + data.sellerUsers.length + data.staffUsers.length,
    sellers: data.sellerProfiles.length,
    stores: data.stores.length,
    products: data.products.length,
    vouchers: data.vouchers.length,
    addresses: data.addresses.length,
    orders: 1,
    reviews: data.reviews.length,
    created,
    skipped,
  };
}
