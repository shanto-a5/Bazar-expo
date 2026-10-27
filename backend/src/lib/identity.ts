/**
 * Server-side identifiers (M7-E).
 *
 * Ids are prefixed exactly like the app's local ids (`usr_`, `ord_`, ...) so a
 * document written by the API and a document written by the device seed stay
 * recognisably the same kind of entity when both are inspected.
 */
import { randomBytes, randomUUID } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

export function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Deterministic PRNG (mulberry32) so seeded datasets are byte-stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function opaqueToken(): string {
  return randomBytes(32).toString('hex');
}
