export { roundMoney } from '@shared/money';

export function formatMoney(amount: number): string {
  const n = Math.round(amount);
  return `\u09F3${n.toLocaleString('en-BD')}`;
}

export function formatMoneyShort(amount: number): string {
  const n = Math.round(amount);
  if (n >= 1_000_000) return `\u09F3${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `\u09F3${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return `\u09F3${n}`;
}

export function discountPercent(regular: number, sale?: number): number {
  if (!sale || sale <= 0 || sale >= regular || regular <= 0) return 0;
  return Math.round(((regular - sale) / regular) * 100);
}
