// Semua timeframe yang diminta user. Ini daftar tampilan di UI — bukan
// berarti semuanya punya data asli. Lihat `support` di bawah untuk status
// jujur tiap TF (lihat README bagian "Batasan timeframe memecoin").
export const MEMECOIN_TIMEFRAMES = [
  "1s",
  "3s",
  "5s",
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
  "3d",
  "7d",
  "1w",
  "30d",
] as const;

export type MemecoinTf = (typeof MEMECOIN_TIMEFRAMES)[number];

export type GtBase = { timeframe: "minute" | "hour" | "day"; aggregate: number };

// Bucket resmi yang didukung endpoint OHLCV GeckoTerminal (satu-satunya
// sumber candle on-chain gratis yang ada — DexScreener TIDAK punya endpoint
// candle sama sekali, cuma data pair snapshot). Aggregate yang GeckoTerminal
// izinkan: minute -> 1/5/15, hour -> 1/4/12, day -> 1.
const GT_NATIVE: Partial<Record<MemecoinTf, GtBase>> = {
  "1m": { timeframe: "minute", aggregate: 1 },
  "5m": { timeframe: "minute", aggregate: 5 },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h": { timeframe: "hour", aggregate: 1 },
  "4h": { timeframe: "hour", aggregate: 4 },
  "1d": { timeframe: "day", aggregate: 1 },
};

// TF yang tidak native tapi bisa dibangun dengan menggabungkan (resample)
// N candle dari base di atas jadi 1 candle. `groupSize` = berapa candle
// base digabung jadi satu candle TF ini.
const GT_RESAMPLE: Partial<Record<MemecoinTf, { base: MemecoinTf; groupSize: number }>> = {
  "30m": { base: "15m", groupSize: 2 },
  "2h": { base: "1h", groupSize: 2 },
  "3d": { base: "1d", groupSize: 3 },
  "7d": { base: "1d", groupSize: 7 },
  "1w": { base: "1d", groupSize: 7 },
  "30d": { base: "1d", groupSize: 30 },
};

export type TfSupport =
  | { status: "native"; gt: GtBase }
  | { status: "resampled"; base: MemecoinTf; groupSize: number; gt: GtBase }
  | { status: "unsupported"; reason: string };

export function resolveTfSupport(tf: MemecoinTf): TfSupport {
  if (GT_NATIVE[tf]) return { status: "native", gt: GT_NATIVE[tf]! };
  const rs = GT_RESAMPLE[tf];
  if (rs) {
    const baseGt = GT_NATIVE[rs.base];
    if (baseGt) return { status: "resampled", base: rs.base, groupSize: rs.groupSize, gt: baseGt };
  }
  return {
    status: "unsupported",
    reason:
      "Tidak ada sumber data gratis (DexScreener/GeckoTerminal/Bitget/pump.fun) yang menyediakan candle sekecil ini untuk token on-chain. Exchange sekelas Binance saja mentok di 1m untuk pair reguler.",
  };
}

/** Gabungkan `groupSize` candle berurutan (lama->baru) jadi 1 candle. */
export function resampleCandles<
  C extends { openTime: number; open: number; high: number; low: number; close: number }
>(candles: C[], groupSize: number): C[] {
  if (groupSize <= 1) return candles;
  const out: C[] = [];
  for (let i = 0; i + groupSize <= candles.length; i += groupSize) {
    const chunk = candles.slice(i, i + groupSize);
    out.push({
      ...chunk[0],
      openTime: chunk[0].openTime,
      open: chunk[0].open,
      close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
    });
  }
  return out;
}
