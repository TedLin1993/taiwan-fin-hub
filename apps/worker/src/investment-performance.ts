export interface InvestmentHistoryValue {
  date: string;
  netWorth: number;
  assetType: string;
  source: string;
}

export interface InvestmentPositionValue {
  id: string;
  symbol: string | null;
  name: string;
  quantity: number | null;
  marketValue: number | null;
  currency: string;
  rateToTwd: number | null;
}

export interface InvestmentTradeValue {
  date: string | null;
  symbol: string | null;
  name: string | null;
  transactionCode: string | null;
  transactionName: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  currency: string;
  rateToTwd: number | null;
}

export interface UnrealizedPositionResult {
  positionId: string;
  costBasis: number | null;
  averageCost: number | null;
  profitLoss: number | null;
  returnRate: number | null;
  available: boolean;
}

export interface UnrealizedPerformancePoint {
  date: string;
  marketValue: number;
  costBasis: number;
  profitLoss: number;
}

export interface UnrealizedPerformanceResult {
  positions: UnrealizedPositionResult[];
  points: UnrealizedPerformancePoint[];
  totalCostBasis: number | null;
  currentProfitLoss: number | null;
  currentReturnRate: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  coveredPositions: number;
  totalPositions: number;
  estimated: boolean;
}

type TradeAction = "buy" | "sell" | "income" | "unknown";
type CostState = { quantity: number; cost: number; valid: boolean };

const BUY_CODES = new Set(["B", "BUY", "SUB"]);
const SELL_CODES = new Set(["S", "SELL", "RED"]);
const INCOME_CODES = new Set(["D", "DIV"]);
const BUY_PATTERN = /買進|買入|申購|認購|扣款/;
const SELL_PATTERN = /賣出|贖回/;
const INCOME_PATTERN = /配息|收益分配|股利|利息/;

function instrumentKey(value: { symbol: string | null; name: string | null }) {
  return (value.symbol || value.name || "").trim().toUpperCase();
}

function tradeAction(trade: InvestmentTradeValue): TradeAction {
  const code = (trade.transactionCode ?? "").trim().toUpperCase();
  const name = (trade.transactionName ?? "").replace(/\s+/g, "");
  if (BUY_CODES.has(code) || BUY_PATTERN.test(name)) return "buy";
  if (SELL_CODES.has(code) || SELL_PATTERN.test(name)) return "sell";
  if (INCOME_CODES.has(code) || INCOME_PATTERN.test(name)) return "income";
  if (trade.amount != null && trade.amount < 0) return "buy";
  return "unknown";
}

function twdRate(currency: string, rateToTwd: number | null) {
  if ((currency || "TWD").toUpperCase() === "TWD") return 1;
  return rateToTwd != null && Number.isFinite(rateToTwd) && rateToTwd > 0
    ? rateToTwd
    : null;
}

function tradeCost(trade: InvestmentTradeValue) {
  const rate = twdRate(trade.currency, trade.rateToTwd);
  if (rate == null) return null;
  // Older TDCC connector versions mislabeled TR002 field 18 as the execution
  // price. The field is commonly 1 and must never become a NT$1 share cost.
  if (trade.price === 1) return null;
  if (trade.amount != null && Number.isFinite(trade.amount))
    return Math.abs(trade.amount) * rate;
  if (
    trade.quantity != null &&
    trade.price != null &&
    Number.isFinite(trade.quantity) &&
    Number.isFinite(trade.price) &&
    trade.price !== 1
  )
    return Math.abs(trade.quantity * trade.price) * rate;
  return null;
}

function applyTrade(
  states: Map<string, CostState>,
  trade: InvestmentTradeValue,
) {
  const action = tradeAction(trade);
  if (action === "income") return;
  const key = instrumentKey(trade);
  const quantity = Math.abs(trade.quantity ?? 0);
  const cost = tradeCost(trade);
  if (!key || !quantity || cost == null || action === "unknown") return;

  const state = states.get(key) ?? { quantity: 0, cost: 0, valid: true };
  if (action === "buy") {
    state.quantity += quantity;
    state.cost += cost;
  } else if (quantity > state.quantity + 1e-6) {
    state.valid = false;
  } else {
    const averageCost = state.quantity === 0 ? 0 : state.cost / state.quantity;
    state.quantity = Math.max(0, state.quantity - quantity);
    state.cost = Math.max(0, state.cost - averageCost * quantity);
  }
  states.set(key, state);
}

function quantitiesMatch(expected: number, actual: number) {
  const tolerance = Math.max(0.01, Math.abs(expected) * 0.001);
  return Math.abs(expected - actual) <= tolerance;
}

function investmentMarketSeries(rows: InvestmentHistoryValue[]) {
  const investmentRows = rows.filter(
    (row) => row.assetType === "stock" || row.assetType === "fund",
  );
  const usableRows =
    investmentRows.length > 0
      ? investmentRows
      : rows.filter(
          (row) => row.source === "tdcc" && row.assetType === "total",
        );
  const identities = new Map<string, InvestmentHistoryValue[]>();
  for (const row of usableRows) {
    const identity = `${row.source}:${row.assetType}`;
    const values = identities.get(identity) ?? [];
    values.push(row);
    identities.set(identity, values);
  }
  for (const values of identities.values())
    values.sort((a, b) => a.date.localeCompare(b.date));

  const dates = [...new Set(usableRows.map((row) => row.date))].sort();
  return dates.map((date) => ({
    date,
    marketValue: [...identities.values()].reduce((sum, values) => {
      let latest = 0;
      for (const row of values) {
        if (row.date > date) break;
        latest = row.netWorth;
      }
      return sum + latest;
    }, 0),
  }));
}

export function buildUnrealizedPerformance(
  history: InvestmentHistoryValue[],
  positions: InvestmentPositionValue[],
  trades: InvestmentTradeValue[],
): UnrealizedPerformanceResult {
  const heldInstrumentKeys = new Set(
    positions
      .filter(
        (position) =>
          (position.quantity ?? 0) > 0 && (position.marketValue ?? 0) > 0,
      )
      .map(instrumentKey)
      .filter(Boolean),
  );
  const sortedTrades = trades
    .filter(
      (trade) => trade.date && heldInstrumentKeys.has(instrumentKey(trade)),
    )
    .slice()
    .sort((a, b) => a.date!.localeCompare(b.date!));
  const currentStates = new Map<string, CostState>();
  for (const trade of sortedTrades) applyTrade(currentStates, trade);

  const positionGroups = new Map<
    string,
    { quantity: number; positions: InvestmentPositionValue[] }
  >();
  const unavailablePositions: InvestmentPositionValue[] = [];
  for (const position of positions) {
    if ((position.quantity ?? 0) <= 0 && (position.marketValue ?? 0) <= 0)
      continue;
    const key = instrumentKey(position);
    if (!key || (position.quantity ?? 0) <= 0) {
      unavailablePositions.push(position);
      continue;
    }
    const group = positionGroups.get(key) ?? { quantity: 0, positions: [] };
    group.quantity += position.quantity ?? 0;
    group.positions.push(position);
    positionGroups.set(key, group);
  }

  const positionResults: UnrealizedPositionResult[] = unavailablePositions.map(
    (position) => ({
      positionId: position.id,
      costBasis: null,
      averageCost: null,
      profitLoss: null,
      returnRate: null,
      available: false,
    }),
  );
  let totalCostBasis = 0;
  let totalMarketValue = 0;
  let coveredPositions = 0;
  for (const [key, group] of positionGroups) {
    const state = currentStates.get(key);
    const available = Boolean(
      state?.valid && quantitiesMatch(group.quantity, state.quantity),
    );
    for (const position of group.positions) {
      const quantityShare = (position.quantity ?? 0) / group.quantity;
      const rate = twdRate(position.currency, position.rateToTwd);
      const marketValue =
        rate == null || position.marketValue == null
          ? null
          : position.marketValue * rate;
      const costBasis = available ? state!.cost * quantityShare : null;
      const profitLoss =
        costBasis == null || marketValue == null
          ? null
          : marketValue - costBasis;
      positionResults.push({
        positionId: position.id,
        costBasis: costBasis == null ? null : Math.round(costBasis),
        averageCost:
          costBasis == null || !position.quantity
            ? null
            : costBasis / position.quantity,
        profitLoss: profitLoss == null ? null : Math.round(profitLoss),
        returnRate:
          profitLoss == null || !costBasis
            ? null
            : (profitLoss / costBasis) * 100,
        available: profitLoss != null,
      });
      if (profitLoss != null && costBasis != null && marketValue != null) {
        coveredPositions += 1;
        totalCostBasis += costBasis;
        totalMarketValue += marketValue;
      }
    }
  }

  const totalPositions = positionResults.length;
  const complete = totalPositions > 0 && coveredPositions === totalPositions;
  const marketSeries = investmentMarketSeries(history);
  const historyStates = new Map<string, CostState>();
  let tradeIndex = 0;
  let historyValid = complete;
  const points = complete
    ? marketSeries.map((point) => {
        while (
          tradeIndex < sortedTrades.length &&
          sortedTrades[tradeIndex]!.date!.slice(0, 10) <= point.date
        ) {
          applyTrade(historyStates, sortedTrades[tradeIndex]!);
          tradeIndex += 1;
        }
        if ([...historyStates.values()].some((state) => !state.valid))
          historyValid = false;
        const costBasis = [...historyStates.values()].reduce(
          (sum, state) => sum + state.cost,
          0,
        );
        return {
          ...point,
          costBasis: Math.round(costBasis),
          profitLoss: Math.round(point.marketValue - costBasis),
        };
      })
    : [];
  const usablePoints = historyValid ? points : [];
  const currentProfitLossRaw = complete
    ? totalMarketValue - totalCostBasis
    : null;
  const currentProfitLoss =
    currentProfitLossRaw == null ? null : Math.round(currentProfitLossRaw);

  return {
    positions: positionResults,
    points: usablePoints,
    totalCostBasis: complete ? Math.round(totalCostBasis) : null,
    currentProfitLoss,
    currentReturnRate:
      currentProfitLossRaw == null || totalCostBasis === 0
        ? null
        : (currentProfitLossRaw / totalCostBasis) * 100,
    periodStart: usablePoints[0]?.date ?? null,
    periodEnd: usablePoints.at(-1)?.date ?? null,
    coveredPositions,
    totalPositions,
    estimated: complete,
  };
}
