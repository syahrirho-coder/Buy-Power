import { Candle } from "./indicator";
import { withTwelveDataKey, TwelveDataError } from "./twelvedata-keys";
import { aggregateTo4h } from "./fx4h";
import { fetchTiingo4h, tiingoKeyCount } from "./tiingo";

export type FxTimeframe = "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

const INTERVAL: Record<FxTimeframe, string> = {
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day",
};

// Cache candle per (simbol, TF) supaya refresh berulang tidak menghabiskan credit.
// TTL ~ setengah durasi candle (min 60 dtk, maks 1 jam). Best-effort per instance.
const TTL_MS: Record<FxTimeframe, number> = {
  "5m": 2.5 * 60_000,
  "15m": 7 * 60_000,
  "30m": 12 * 60_000,
  "1h": 20 * 60_000,
  "4h": 45 * 60_000,
  "1d": 60 * 60_000,
};
const cache = new Map<string, { at: number; candles: Candle[] }>();

function parseTime(dt: string): number {
  // timezone=UTC -> "2026-09-28 10:15:00" atau "2026-09-28" (1day)
  const iso = dt.length <= 10 ? `${dt}T00:00:00Z` : `${dt.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

/** Ambil candle dari Twelve Data (urut lama -> baru, sama seperti fetchKlines crypto). */
export async function fetchFxKlines(
  symbol: string,
  tf: FxTimeframe,
  deadline: number,
  outputsize = 400
): Promise<{ candles: Candle[]; source: "twelvedata" | "tiingo" }> {
  const ck = `${symbol}|${tf}|${outputsize}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS[tf]) {
    return { candles: hit.candles, source: tf === "4h" ? "tiingo" : "twelvedata" };
  }

  // Twelve Data tidak punya 4h -> pakai Tiingo (resampleFreq=4hour, 0 credit Twelve Data).
  // Kalau Tiingo belum di-set / gagal, cadangan: gabungkan candle 1h Twelve Data.
  if (tf === "4h") {
    let candles: Candle[];
    let source: "twelvedata" | "tiingo" = "tiingo";
    try {
      if (!tiingoKeyCount()) throw new Error("no tiingo key");
      candles = await fetchTiingo4h(symbol);
    } catch {
      const h1 = await fetchFxKlines(symbol, "1h", deadline, 900);
      candles = aggregateTo4h(h1.candles);
      source = "twelvedata";
    }
    cache.set(ck, { at: Date.now(), candles });
    return { candles, source };
  }

  const candles = await withTwelveDataKey(deadline, async (key) => {
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${INTERVAL[tf]}&outputsize=${outputsize}&timezone=UTC&order=DESC&apikey=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* body bukan JSON */
    }
    // Twelve Data sering balas HTTP 200 dengan {"code":429,"status":"error"}.
    const code = Number(json?.code) || (!res.ok ? res.status : 0);
    if (json?.status === "error" || code) {
      throw new TwelveDataError(code || 500, String(json?.message ?? `HTTP ${res.status}`));
    }
    const rows: any[] = json?.values ?? [];
    if (!rows.length) throw new TwelveDataError(404, `Twelve Data ${symbol} ${tf}: kosong`);
    return rows
      .map((r) => ({
        openTime: parseTime(String(r.datetime)),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
      }))
      .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low))
      .reverse();
  });

  cache.set(ck, { at: Date.now(), candles });
  return { candles, source: "twelvedata" };
}
