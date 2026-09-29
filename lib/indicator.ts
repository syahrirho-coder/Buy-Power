// Port of ChartPrime's "Support and Resistance Power Channel" logic.
// Pine source reference: length=130 lookback for the channel, ATR(200)*0.5
// sets the channel half-height. The bottom channel (near the rolling low)
// is the "Buy Power" zone; the top channel (near the rolling high) is the
// "Sell Power" zone.

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type Zone = { top: number; bottom: number };

export type ZoneResult = {
  buyZone: Zone;
  sellZone: Zone;
  rollingHigh: number;
  rollingLow: number;
  atr: number;
  lastClose: number;
  inBuyZone: boolean;
  inSellZone: boolean;
  buyPower: number; // count of bullish candles over `length`
  sellPower: number; // count of bearish candles over `length`
};

const CHANNEL_LENGTH = 130;
const ATR_LENGTH = 200;

// Wilder's RMA, seeded the same way ta.rma does in Pine: simple average of
// the first `period` values, then exponential smoothing after that.
function wilderATR(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

export function computeZones(candles: Candle[]): ZoneResult | null {
  if (candles.length < ATR_LENGTH + 1) return null;

  const atrRaw = wilderATR(candles, ATR_LENGTH);
  if (atrRaw === null) return null;
  const atr = atrRaw * 0.5;

  const window = candles.slice(-CHANNEL_LENGTH);
  const rollingHigh = Math.max(...window.map((c) => c.high));
  const rollingLow = Math.min(...window.map((c) => c.low));

  const sellZone: Zone = { top: rollingHigh + atr, bottom: rollingHigh - atr };
  const buyZone: Zone = { top: rollingLow + atr, bottom: rollingLow - atr };

  let buyPower = 0;
  let sellPower = 0;
  for (const c of window) {
    if (c.close > c.open) buyPower++;
    else if (c.close < c.open) sellPower++;
  }

  const lastClose = candles[candles.length - 1].close;
  const inBuyZone = lastClose >= buyZone.bottom && lastClose <= buyZone.top;
  const inSellZone = lastClose >= sellZone.bottom && lastClose <= sellZone.top;

  return {
    buyZone,
    sellZone,
    rollingHigh,
    rollingLow,
    atr,
    lastClose,
    inBuyZone,
    inSellZone,
    buyPower,
    sellPower,
  };
}
