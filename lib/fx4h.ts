import { Candle } from "./indicator";

const H4 = 4 * 3600_000;

/** Gabungkan candle 1h (urut lama -> baru) jadi 4h, bucket selaras UTC. Dipakai sebagai cadangan. */
export function aggregateTo4h(hourly: Candle[]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of hourly) {
    const bucket = Math.floor(c.openTime / H4) * H4;
    if (!cur || cur.openTime !== bucket) {
      if (cur) out.push(cur);
      cur = { openTime: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}
