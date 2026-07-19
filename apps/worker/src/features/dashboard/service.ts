import { loadDashboardSummary } from "./repository";

export async function getDashboardSummary(db: D1Database) {
  const { invoiceRow, investmentRow, bankAccountRow, bankBalanceRow } =
    await loadDashboardSummary(db);
  return {
    invoiceCount: invoiceRow?.count ?? 0,
    investmentCount: investmentRow?.count ?? 0,
    totalInvestmentValue: investmentRow?.total ?? 0,
    bankAccountCount: bankAccountRow?.count ?? 0,
    totalBankBalance: bankBalanceRow?.total ?? 0,
  };
}
