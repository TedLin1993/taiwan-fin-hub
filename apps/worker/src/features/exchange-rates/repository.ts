export type ExchangeRateRow = {
  currency: string;
  rateTwd: number;
  updatedAt: string;
};

export async function listExchangeRates(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT currency, rate_to_twd AS rateTwd, updated_at AS updatedAt
     FROM exchange_rates
     ORDER BY currency ASC`,
    )
    .all<ExchangeRateRow>();
  return rows.results;
}

export async function upsertExchangeRates(
  db: D1Database,
  rates: Array<{ currency: string; rate: number }>,
  now: string,
) {
  if (rates.length === 0) return;
  await db.batch(
    rates.map(({ currency, rate }) =>
      db
        .prepare(
          `INSERT INTO exchange_rates (currency, rate_to_twd, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(currency) DO UPDATE SET
         rate_to_twd = excluded.rate_to_twd,
         updated_at = excluded.updated_at`,
        )
        .bind(currency, rate, now),
    ),
  );
}
