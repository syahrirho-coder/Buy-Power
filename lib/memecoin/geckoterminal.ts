import { Candle } from "../indicator";
import { GtBase } from "./timeframes";

const GT_BASE_URL = "https://api.geckoterminal.com/api/v2";

// GeckoTerminal: 30 req/menit, gratis, tanpa API key. Kita simple-cache
// per (network,pool,timeframe,aggregate) selama proses berjalan supaya
// beberapa TF turunan (mis. 30m & 15m) tidak fetch dua kali.
const cache = new Map<string, Promise<Candle[]>>();

export type GtNetwork = string; // "solana" | "eth" | "bsc" | "base" | ...

async function fetchOhlcvRaw(
  network: GtNetwork,
  poolAddress: string,
  gt: GtBase,
  limit: number
): Promise<Candle[]> {
  const url = `${GT_BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/${gt.timeframe}?aggregate=${gt.aggregate}&limit=${limit}&currency=usd`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`GeckoTerminal OHLCV ${network}/${poolAddress} ${gt.timeframe}x${gt.aggregate}: ${res.status}`);
  }
  const json = await res.json();
  const rows: any[] = json?.data?.attributes?.ohlcv_list ?? [];
  if (!rows.length) throw new Error("GeckoTerminal: candle kosong (pool baru / likuiditas tipis)");
  // GeckoTerminal returns newest-first: [timestamp, open, high, low, close, volume]
  return rows
    .map((r) => ({
      openTime: r[0] * 1000,
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
    }))
    .reverse();
}

/** GeckoTerminal caps `limit` per call at 1000. */
export async function fetchGeckoTerminalOhlcv(
  network: GtNetwork,
  poolAddress: string,
  gt: GtBase,
  limit = 1000
): Promise<Candle[]> {
  const key = `${network}:${poolAddress}:${gt.timeframe}:${gt.aggregate}:${limit}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchOhlcvRaw(network, poolAddress, gt, Math.min(limit, 1000));
    cache.set(key, p);
  }
  return p;
}
