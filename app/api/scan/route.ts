import { NextRequest, NextResponse } from "next/server";
import { fetchTopSymbols, fetchKlines, Timeframe } from "@/lib/exchanges";
import { computeZones } from "@/lib/indicator";
import { mapWithConcurrency } from "@/lib/concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — needs Vercel Fluid Compute / Pro for the full 60s

const TIMEFRAMES: Timeframe[] = ["5m", "15m", "30m", "1h", "4h", "1d"];
const DEFAULT_LIMIT = 500; // cukup besar buat nyakup semua koin di whitelist Pluang (lib/pluang-symbols.ts)
const CONCURRENCY = 12; // 6 TF per simbol -> maks ~72 request paralel

type TfResult = {
  timeframe: Timeframe;
  price: number;
  inBuyZone: boolean;
  inSellZone: boolean;
  buyZone: { top: number; bottom: number };
  sellZone: { top: number; bottom: number };
  buyPower: number;
  sellPower: number;
  source: string;
} | { timeframe: Timeframe; error: string };

type SymbolResult = {
  symbol: string;
  volume: number;
  change24h: number | null;
  sparkline: number[];
  timeframes: TfResult[];
  allTimeframesInBuyZone: boolean;
  buyCount: number;
  sellCount: number;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, 1000)
      : DEFAULT_LIMIT;

  let symbols;
  try {
    symbols = await fetchTopSymbols(limit);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Gagal ambil daftar simbol: ${err.message ?? err}` },
      { status: 502 }
    );
  }

  const results = await mapWithConcurrency(
    symbols,
    CONCURRENCY,
    async (s): Promise<SymbolResult> => {
      // Sparkline diambil dari candle 15m yang sudah ditarik sebagai salah satu
      // TF (60 titik terakhir ≈ 15 jam) — tidak ada request tambahan.
      let sparkline: number[] = [];

      const timeframes: TfResult[] = await Promise.all(
        TIMEFRAMES.map(async (tf): Promise<TfResult> => {
          try {
            const { candles, source } = await fetchKlines(s.symbol, tf);
            if (tf === "15m" && candles.length > 0) {
              sparkline = candles.slice(-60).map((c) => c.close);
            }
            const zones = computeZones(candles);
            if (!zones) {
              return { timeframe: tf, error: "Kandel tidak cukup" };
            }
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

      const allTimeframesInBuyZone = timeframes.every(
        (t) => "inBuyZone" in t && t.inBuyZone
      );

      const buyCount = timeframes.filter((t) => "inBuyZone" in t && t.inBuyZone).length;
      const sellCount = timeframes.filter((t) => "inSellZone" in t && t.inSellZone).length;

      return {
        symbol: s.symbol,
        volume: s.volume,
        change24h: s.change24h,
        sparkline,
        timeframes,
        allTimeframesInBuyZone,
        buyCount,
        sellCount,
      };
    }
  );

  // Yang paling banyak TF-nya di zona (buy/sell) naik ke atas, lalu volume.
  results.sort((a, b) => {
    const za = a.buyCount + a.sellCount;
    const zb = b.buyCount + b.sellCount;
    if (za !== zb) return zb - za;
    return b.volume - a.volume;
  });

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    scanned: symbols.length,
    matches: results.filter((r) => r.buyCount + r.sellCount > 0).length,
    results,
  });
}
