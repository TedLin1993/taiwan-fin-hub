import { listExchangeRates, upsertExchangeRates } from "./repository";

export function getExchangeRates(db: D1Database) {
  return listExchangeRates(db);
}

export async function updateExchangeRates(
  db: D1Database,
  rates: Record<string, number>,
) {
  await upsertExchangeRates(
    db,
    Object.entries(rates).map(([currency, rate]) => ({
      currency: currency.toUpperCase(),
      rate,
    })),
    new Date().toISOString(),
  );
}
