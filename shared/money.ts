/**
 * Money primitives shared by the Expo app and the API server (M7-E).
 *
 * Every persisted and transported amount is a 2-decimal number. Both sides
 * round with the same helper so a cart total computed on the device and a
 * total recomputed by the server can never disagree by a cent.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumMoney(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
