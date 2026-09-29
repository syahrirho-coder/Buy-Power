// TradingView cuma resolve simbol yang memang mereka index (exchange
// beneran: BINANCE:, BYBIT:, OKX:, BITGET:, dst — total ribuan simbol,
// tapi BUKAN sembarang pool DEX baru). Jadi tradingview.com/chart?symbol=
// hanya valid kalau token itu juga listing spot di exchange yang
// TradingView index. Untuk token yang cuma ada di DEX/pump.fun dan belum
// listing CEX, TIDAK ADA link tradingview.com yang valid — di sini kita
// jujur kasih link GeckoTerminal (chart-nya sendiri juga pakai TradingView
// charting library sebagai widget, tapi bukan domain tradingview.com).

const cexListingCache = new Map<string, Promise<string | null>>();

async function checkTicker(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

/** Cek apakah `${base}USDT` listing di Binance / Bitget spot (murah: cuma cek 1 harga, bukan klines). */
async function findCexExchange(baseSymbol: string): Promise<string | null> {
  const sym = `${baseSymbol.toUpperCase()}USDT`;
  const key = sym;
  let p = cexListingCache.get(key);
  if (p) return p;

  p = (async () => {
    if (await checkTicker(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`)) {
      return "BINANCE";
    }
    if (await checkTicker(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${sym}`)) {
      return "BITGET";
    }
    return null;
  })();
  cexListingCache.set(key, p);
  return p;
}

export type ChartLink = { label: string; url: string; isRealTradingView: boolean };

/**
 * Kalau token juga listing di CEX (Binance/Bitget) -> link tradingview.com
 * asli. Kalau tidak (murni token DEX/pump.fun baru) -> link GeckoTerminal,
 * ditandai `isRealTradingView: false` biar UI tidak menyesatkan.
 */
export async function buildChartLink(
  baseSymbol: string,
  geckoterminalUrl: string | null
): Promise<ChartLink> {
  const exchange = await findCexExchange(baseSymbol);
  if (exchange) {
    return {
      label: "TradingView",
      url: `https://www.tradingview.com/chart/?symbol=${exchange}:${baseSymbol.toUpperCase()}USDT`,
      isRealTradingView: true,
    };
  }
  if (geckoterminalUrl) {
    return { label: "Chart (GeckoTerminal)", url: geckoterminalUrl, isRealTradingView: false };
  }
  return { label: "Chart", url: "#", isRealTradingView: false };
}
