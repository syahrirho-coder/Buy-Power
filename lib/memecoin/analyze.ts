import { computeZones } from "../indicator";
import { fetchGeckoTerminalOhlcv } from "./geckoterminal";
import { MemecoinTf, resampleCandles, resolveTfSupport } from "./timeframes";

export type TfAnalysis =
  | {
      timeframe: MemecoinTf;
      status: "ok";
      price: number;
      inBuyZone: boolean;
      inSellZone: boolean;
      buyZone: { top: number; bottom: number };
      buyPower: number;
      sellPower: number;
      source: "geckoterminal";
    }
  | { timeframe: MemecoinTf; status: "insufficient_data"; message: string }
  | { timeframe: MemecoinTf; status: "unsupported"; message: string }
  | { timeframe: MemecoinTf; status: "error"; message: string };

export async function analyzeMemecoinTf(
  network: string,
  poolAddress: string,
  tf: MemecoinTf
): Promise<TfAnalysis> {
  const support = resolveTfSupport(tf);

  if (support.status === "unsupported") {
    return { timeframe: tf, status: "unsupported", message: support.reason };
  }

  try {
    const raw = await fetchGeckoTerminalOhlcv(network, poolAddress, support.gt, 1000);
    const candles = support.status === "resampled" ? resampleCandles(raw, support.groupSize) : raw;

    const zones = computeZones(candles);
    if (!zones) {
      return {
        timeframe: tf,
        status: "insufficient_data",
        message: `Butuh minimal 201 candle di resolusi ini buat hitung ATR(200); token ini baru punya ${candles.length}. Token/pool ini kemungkinan masih terlalu baru untuk TF sebesar ini.`,
      };
    }

    return {
      timeframe: tf,
      status: "ok",
      price: zones.lastClose,
      inBuyZone: zones.inBuyZone,
      inSellZone: zones.inSellZone,
      buyZone: zones.buyZone,
      buyPower: zones.buyPower,
      sellPower: zones.sellPower,
      source: "geckoterminal",
    };
  } catch (err: any) {
    return { timeframe: tf, status: "error", message: String(err?.message ?? err) };
  }
}
