import { Candle } from "./indicator";
import { PLUANG_BASES } from "./pluang-symbols";

export type Timeframe = "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

// How many candles to pull. Needs to comfortably exceed ATR_LENGTH (200) so
// Wilder's smoothing has room to converge before we read the last value.
const KLINE_LIMIT = 400;

const STABLE_BASES = new Set([
  "USDC",
  "BUSD",
  "TUSD",
  "FDUSD",
  "DAI",
  "USDP",
  "EUR",
  "GBP",
  "TRY",
  "BRL",
  "USTC",
  "USDS",
]);

const LEVERAGED_MARKERS = ["UP", "DOWN", "BULL", "BEAR"];

export type SymbolInfo = { symbol: string; volume: number; change24h: number | null };

/**
 * Universe simbol dibatasi ke `PLUANG_BASES` (lihat lib/pluang-symbols.ts) —
 * cuma koin yang beneran listing di app Pluang, bukan semua pair USDT yang
 * ada di Binance. Volume 24h tetap ditarik dari Binance ticker (kalau ada)
 * buat keperluan sorting/tampilan; koin yang tidak listing spot di Binance
 * (misal cuma ada di Bybit/OKX) tetap ikut masuk dengan volume 0, dan tetap
 * bisa di-scan karena `fetchKlines` sudah fallback Binance → Bybit → OKX.
 */
export async function fetchTopSymbols(limit: number): Promise<SymbolInfo[]> {
  const volumeBySymbol = new Map<string, number>();
  const changeBySymbol = new Map<string, number>();
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (res.ok) {
      const data: any[] = await res.json();
      for (const t of data) {
        if (typeof t.symbol === "string" && t.symbol.endsWith("USDT")) {
          const v = parseFloat(t.quoteVolume);
          if (Number.isFinite(v)) volumeBySymbol.set(t.symbol, v);
          const c = parseFloat(t.priceChangePercent);
          if (Number.isFinite(c)) changeBySymbol.set(t.symbol, c);
        }
      }
    }
  } catch {
    /* Binance down — tetap lanjut, semua koin Pluang dapat volume 0. */
  }

  const pluangPairs = Array.from(PLUANG_BASES)
    .filter((base) => {
      if (STABLE_BASES.has(base)) return false;
      if (LEVERAGED_MARKERS.some((m) => base.endsWith(m))) return false;
      return true;
    })
    .map((base) => {
      const symbol = `${base}USDT`;
      return {
        symbol,
        volume: volumeBySymbol.get(symbol) ?? 0,
        change24h: changeBySymbol.get(symbol) ?? null,
      };
    })
    .sort((a, b) => b.volume - a.volume);

  return pluangPairs.slice(0, limit);
}

function toBinanceInterval(tf: Timeframe): string {
  return tf; // "5m" | "15m" | "30m" | "1h" | "4h" | "1d" match Binance's own strings
}

function toBybitInterval(tf: Timeframe): string {
  const map: Record<Timeframe, string> = { "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D" };
  return map[tf];
}

function toOkxBar(tf: Timeframe): string {
  const map: Record<Timeframe, string> = { "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1Dutc" };
  return map[tf];
}

function toOkxInstId(symbol: string): string {
  // Our universe is USDT-quoted only, so this split is safe.
  const base = symbol.slice(0, -4);
  return `${base}-USDT`;
}

async function fetchBinanceKlines(
  symbol: string,
  tf: Timeframe,
  limit: number = KLINE_LIMIT
): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${toBinanceInterval(
    tf
  )}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines ${symbol} ${tf}: ${res.status}`);
  const raw: any[] = await res.json();
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
  }));
}

async function fetchBybitKlines(
  symbol: string,
  tf: Timeframe,
  limit: number = KLINE_LIMIT
): Promise<Candle[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${toBybitInterval(
    tf
  )}&limit=${Math.min(limit, 1000)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit klines ${symbol} ${tf}: ${res.status}`);
  const json = await res.json();
  const rows: any[] = json?.result?.list ?? [];
  if (!rows.length) throw new Error(`Bybit klines ${symbol} ${tf}: empty`);
  // Bybit returns newest-first; each row: [start, open, high, low, close, volume, turnover]
  return rows
    .map((r) => ({
      openTime: parseInt(r[0], 10),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
    }))
    .reverse();
}

async function fetchOkxKlines(
  symbol: string,
  tf: Timeframe,
  limit: number = KLINE_LIMIT
): Promise<Candle[]> {
  const instId = toOkxInstId(symbol);
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${toOkxBar(
    tf
  )}&limit=${Math.min(limit, 300)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OKX klines ${symbol} ${tf}: ${res.status}`);
  const json = await res.json();
  const rows: any[] = json?.data ?? [];
  if (!rows.length) throw new Error(`OKX klines ${symbol} ${tf}: empty`);
  // OKX returns newest-first; each row: [ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm]
  return rows
    .map((r) => ({
      openTime: parseInt(r[0], 10),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
    }))
    .reverse();
}

/** Try Binance first, fall back to Bybit, then OKX. All three are free/keyless. */
export async function fetchKlines(
  symbol: string,
  tf: Timeframe,
  limit: number = KLINE_LIMIT
): Promise<{ candles: Candle[]; source: "binance" | "bybit" | "okx" }> {
  try {
    const candles = await fetchBinanceKlines(symbol, tf, limit);
    if (candles.length > 0) return { candles, source: "binance" };
  } catch {
    /* fall through */
  }
  try {
    const candles = await fetchBybitKlines(symbol, tf, limit);
    if (candles.length > 0) return { candles, source: "bybit" };
  } catch {
    /* fall through */
  }
  const candles = await fetchOkxKlines(symbol, tf, limit);
  return { candles, source: "okx" };
}
