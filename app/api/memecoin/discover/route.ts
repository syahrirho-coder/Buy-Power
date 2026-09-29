import { NextRequest, NextResponse } from "next/server";
import {
  DEXSCREENER_TO_GECKOTERMINAL,
  DexPair,
  dexscreenerPairUrl,
  discoverMemecoins,
  geckoterminalPoolUrl,
  isPumpFunPair,
  searchPairs,
} from "@/lib/memecoin/dexscreener";
import { buildChartLink } from "@/lib/memecoin/links";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function toResultItem(p: DexPair) {
  const gtUrl = geckoterminalPoolUrl(p);
  const network = DEXSCREENER_TO_GECKOTERMINAL[p.chainId] ?? null;
  return {
    chainId: p.chainId,
    network, // slug GeckoTerminal, dipakai frontend buat manggil /analyze
    dexId: p.dexId,
    isPumpFun: isPumpFunPair(p),
    pairAddress: p.pairAddress,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    tokenAddress: p.baseToken.address,
    priceUsd: p.priceUsd ? parseFloat(p.priceUsd) : null,
    liquidityUsd: p.liquidity?.usd ?? null,
    fdv: p.fdv ?? null,
    volume24h: p.volume?.h24 ?? null,
    priceChange24h: p.priceChange?.h24 ?? null,
    logoUrl: p.info?.imageUrl ?? null,
    dexscreenerUrl: dexscreenerPairUrl(p),
    geckoterminalUrl: gtUrl,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain") ?? undefined; // kosongkan utk semua chain
  const q = searchParams.get("q");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "40", 10) || 40, 100);
  const withChart = searchParams.get("withChart") === "1";

  try {
    let pairs: DexPair[];
    if (q) {
      pairs = await searchPairs(q);
      if (chain) pairs = pairs.filter((p) => p.chainId === chain);
      pairs = pairs.slice(0, limit);
    } else {
      pairs = await discoverMemecoins({ chain, limit });
    }

    let items = pairs.map(toResultItem);

    // Link TradingView asli butuh 1-2 network call per token (cek listing
    // CEX) — cuma dilakukan kalau diminta eksplisit lewat ?withChart=1,
    // biar list utama tetap cepat.
    if (withChart) {
      items = await Promise.all(
        items.map(async (it) => {
          const chart = await buildChartLink(it.symbol, it.geckoterminalUrl);
          return { ...it, chart };
        })
      );
    }

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      chain: chain ?? "all",
      count: items.length,
      results: items,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Gagal ambil data dari DexScreener: ${err.message ?? err}` },
      { status: 502 }
    );
  }
}
