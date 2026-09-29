import { Candle } from "./indicator";

/**
 * Sumber KHUSUS 4h untuk forex & gold: Tiingo FX REST (resampleFreq=4hour).
 *
 * Env:
 *   TIINGO_API_KEYS=key1,key2   (dipisah koma/spasi; 1 key juga boleh)
 *   TIINGO_API_KEY=key          (opsional, digabung ke pool)
 *
 * Key dirotasi round-robin; kalau kena 429/401/403 otomatis coba key berikutnya.
 */
let keys: string[] | null = null;
let rr = 0;

function loadKeys(): string[] {
  if (keys) return keys;
  const raw = `${process.env.TIINGO_API_KEYS ?? ""},${process.env.TIINGO_API_KEY ?? ""}`;
  keys = [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
  return keys;
}

export function tiingoKeyCount(): number {
  return loadKeys().length;
}

/** "XAU/USD" -> "xauusd" */
const tiingoTicker = (symbol: string) => symbol.replace("/", "").toLowerCase();

/** Candle 4h (urut lama -> baru). Ambil 90 hari ke belakang (~390 candle, cukup buat ATR 200). */
export async function fetchTiingo4h(symbol: string): Promise<Candle[]> {
  const pool = loadKeys();
  if (!pool.length) throw new Error("TIINGO_API_KEYS belum di-set");

  const start = new Date(Date.now() - 90 * 86400_000);
  const startDate = `${start.getUTCFullYear()}-${start.getUTCMonth() + 1}-${start.getUTCDate()}`;
  const base =
    `https://api.tiingo.com/tiingo/fx/${tiingoTicker(symbol)}/prices` +
    `?startDate=${startDate}&resampleFreq=4hour`;

  let lastErr = "";
  for (let i = 0; i < pool.length; i++) {
    const key = pool[(rr + i) % pool.length];
    const res = await fetch(`${base}&token=${key}`, { cache: "no-store" });
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      lastErr = `Tiingo ${symbol} 4h: HTTP ${res.status}`;
      continue; // coba key lain
    }
    if (!res.ok) throw new Error(`Tiingo ${symbol} 4h: HTTP ${res.status}`);
    rr = (rr + i + 1) % pool.length;

    const rows: any = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Tiingo ${symbol} 4h: kosong`);
    const candles: Candle[] = rows
      .map((r) => ({
        openTime: Date.parse(String(r.date)),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
      }))
      .filter((c) => [c.openTime, c.open, c.high, c.low, c.close].every(Number.isFinite))
      .sort((a, b) => a.openTime - b.openTime);
    if (candles.length < 2) throw new Error(`Tiingo ${symbol} 4h: kandel tidak cukup`);
    return candles;
  }
  throw new Error(lastErr || "Tiingo: semua key gagal");
}
