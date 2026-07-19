import {
  calculateBankDepositValue,
  findBankHistoryDateBounds,
  listNetWorthHistory,
  upsertBankDepositHistory,
  type NetWorthPageCursor,
} from "./repository";

export async function getNetWorthPage(
  db: D1Database,
  limit: number,
  cursor?: NetWorthPageCursor,
) {
  const rows = await listNetWorthHistory(db, limit + 1, cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    hasMore,
    last,
    history: page.map(({ id: _id, ...row }) => row).reverse(),
  };
}

export function dateFromIso(iso: string) {
  return iso.slice(0, 10);
}

export async function rebuildBankDepositHistory(
  db: D1Database,
  dates: string[],
) {
  if (dates.length === 0) return;
  const points = [];
  for (const date of dates) {
    points.push({ date, netWorth: await calculateBankDepositValue(db, date) });
  }
  await upsertBankDepositHistory(db, points, new Date().toISOString());
}

export async function rebuildBankDepositHistoryRange(
  db: D1Database,
  from?: string,
  to?: string,
) {
  const bounds = await findBankHistoryDateBounds(db);
  if (!bounds?.minDate || !bounds.maxDate) return { dates: 0 };
  const resolvedFrom = from ?? bounds.minDate;
  const resolvedTo = to ?? bounds.maxDate;
  if (resolvedFrom > resolvedTo) return { dates: 0 };
  const dates = enumerateDates(resolvedFrom, resolvedTo);
  await rebuildBankDepositHistory(db, dates);
  return { dates: dates.length, from: resolvedFrom, to: resolvedTo };
}

function enumerateDates(from: string, to: string) {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
