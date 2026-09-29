import { NextResponse } from "next/server";
import { computeZones } from "@/lib/indicator";
import { mapWithConcurrency } from "@/lib/concurrency";
import { FX_INSTRUMENTS } from "@/lib/forex-symbols";
import { fetchFxKlines, FxTimeframe } from "@/lib/twelvedata";
import { getTwelveDataUsage, twelveDataKeyCount } from "@/lib/twelvedata-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIMEFRAMES: FxTimeframe[] = ["5m", "15m", "30m", "1h", "4h", "1d"];
const CONCURRENCY = 24;
// Sisakan ~6 detik dari maxDuration supaya response tetap sempat dikirim.
const BUDGET_MS = 52_000;

type TfResult =
  | {
      timeframe: FxTimeframe;
      price: number;
      inBuyZone: boolean;
      inSellZone: boolean;
      buyZone: { top: number; bottom: number };
      sellZone: { top: number; bottom: number };
      buyPower: number;
      sellPower: number;
      source: string;
    }
  | { timeframe: FxTimeframe; error: string };

export async function GET() {
  if (twelveDataKeyCount() === 0) {
    return NextResponse.json(
      { error: "TWELVEDATA_API_KEYS belum di-set di environment (isi sampai 10 key dipisah koma)." },
      { status: 500 }
    );
  }

  const deadline = Date.now() + BUDGET_MS;

  const results = await mapWithConcurrency(FX_INSTRUMENTS, CONCURRENCY, async (inst) => {
    let sparkline: number[] = [];
    let change24h: number | null = null;

    const timeframes: TfResult[] = await Promise.all(
      TIMEFRAMES.map(async (tf): Promise<TfResult> => {
        try {
          const { candles, source } = await fetchFxKlines(inst.symbol, tf, deadline);
          if (tf === "15m") sparkline = candles.slice(-60).map((c) => c.close);
          if (tf === "1d" && candles.length >= 2) {
            const prev = candles[candles.length - 2].close;
            const last = candles[candles.length - 1].close;
            if (prev) change24h = ((last - prev) / prev) * 100;
          }
          const zones = computeZones(candles);
          if (!zones) return { timeframe: tf, error: "Kandel tidak cukup" };
          return {
            timeframe: tf,
            price: zones.lastClose,
            inBuyZone: zones.inBuyZone,
            inSellZone: zones.inSellZone,
            buyZone: zones.buyZone,
            sellZone: zones.sellZone,
            buyPower: zones.buyPower,
            sellPower: zones.sellPower,
            source,
          };
        } catch (err: any) {
          return { timeframe: tf, error: String(err?.message ?? err) };
        }
      })
    );

    const buyCount = timeframes.filter((t) => "inBuyZone" in t && t.inBuyZone).length;
    const sellCount = timeframes.filter((t) => "inSellZone" in t && t.inSellZone).length;

    return {
      symbol: inst.base,
      name: inst.name,
      kind: inst.kind,
      volume: 0,
      change24h,
      sparkline,
      timeframes,
      allTimeframesInBuyZone: timeframes.every((t) => "inBuyZone" in t && t.inBuyZone),
      buyCount,
      sellCount,
    };
  });

  results.sort((a, b) => b.buyCount + b.sellCount - (a.buyCount + a.sellCount));

  const errors = results.flatMap((r) => r.timeframes.filter((t) => "error" in t)).length;

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    scanned: results.length,
    matches: results.filter((r) => r.buyCount + r.sellCount > 0).length,
    errors,
    usage: getTwelveDataUsage(),
    results,
  });
}
