import { NextRequest, NextResponse } from "next/server";
import { getGmgnUsage, getTrenches, TrenchesType } from "@/lib/gmgn/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Kriteria contoh (4) yang dipakai buat nyaring "berpotensi cuan besar",
// diadaptasi dari Token Quality Filter Criteria di skill gmgn-market:
// - smart_degen_count >= 1 (ada smart money yang pegang/beli)
// - rug_ratio < 0.3 dan bukan wash trading (anti tipu-tipu)
// - top_10_holder_rate < 0.5 (saldo tidak numpuk di segelintir wallet)
// - liquidity > $20rb (bisa dijual keluar tanpa slippage brutal)
// Ini SARINGAN AWAL berbasis data platform, BUKAN jaminan 100x — lihat
// README untuk batasannya.
function passesScreen(t: any): boolean {
  const smartDegen = t.smart_degen_count ?? 0;
  const renowned = t.renowned_count ?? 0;
  const rug = t.rug_ratio ?? 0;
  const top10 = t.top_10_holder_rate ?? 0;
  const liq = t.liquidity ?? 0;
  if (t.is_wash_trading) return false;
  if (rug > 0.3) return false;
  if (top10 > 0.5) return false;
  if (liq < 20_000) return false;
  return smartDegen >= 1 || renowned >= 1;
}

// Nama field logo persis dari trenches API belum terverifikasi 100% di
// dokumentasi terbuka GMGN — dicoba beberapa kemungkinan key umum (logo,
// image, image_url, icon, uri) baru fallback ke null. Kalau ternyata semua
// kosong, frontend tetap punya cascade fallback lain (DexScreener CDN by
// address, baru avatar huruf sebagai upaya terakhir) — lihat gmgn-panel.tsx.
function pickLogo(t: any): string | null {
  return t.logo ?? t.image ?? t.image_url ?? t.icon ?? t.uri ?? null;
}

const CHAIN_TO_DEXSCREENER: Record<string, string> = {
  sol: "solana",
  bsc: "bsc",
  base: "base",
  eth: "ethereum",
};

function toResultItem(t: any, chain: string) {
  const buys = t.buys_24h ?? 0;
  const sells = t.sells_24h ?? 0;
  const marketCap = t.usd_market_cap ?? t.market_cap ?? null;
  const volume24h = t.volume_24h ?? t.volume ?? null;
  const createdTimestamp = t.created_timestamp ?? null;

  // "Fresh momentum": umur token dari created_timestamp (detik unix), dan
  // rasio volume 24h terhadap market cap sebagai proxy seberapa "panas"
  // token dibanding ukurannya — makin kecil mcap-nya, makin gede ruang gerak
  // matematisnya (lihat diskusi di chat). Ini BUKAN indikator harga naik
  // duluan/telat secara presisi (butuh data candle per-menit yang trenches
  // API tidak sediakan), tapi cukup buat nyaring "masih kecil & lagi ramai"
  // vs "udah gede & sepi".
  const ageMinutes = createdTimestamp ? Math.max(0, Math.floor((Date.now() / 1000 - createdTimestamp) / 60)) : null;
  const fresh = ageMinutes !== null && ageMinutes <= FRESH_MAX_MINUTES;
  const volMcapRatio = marketCap && marketCap > 0 && volume24h !== null ? +(volume24h / marketCap).toFixed(2) : null;

  return {
    chain,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    logoUrl: pickLogo(t),
    dexscreenerChainId: CHAIN_TO_DEXSCREENER[chain] ?? chain,
    launchpadPlatform: t.launchpad_platform,
    marketCap,
    liquidity: t.liquidity ?? null,
    volume24h,
    holderCount: t.holder_count ?? null,
    smartDegenCount: t.smart_degen_count ?? 0,
    renownedCount: t.renowned_count ?? 0,
    buys24h: buys,
    sells24h: sells,
    buySellRatio: sells > 0 ? +(buys / sells).toFixed(2) : buys > 0 ? Infinity : null,
    rugRatio: t.rug_ratio ?? null,
    top10HolderRate: t.top_10_holder_rate ?? null,
    createdTimestamp,
    ageMinutes,
    fresh,
    volMcapRatio,
    dexscreenerUrl: `https://dexscreener.com/${CHAIN_TO_DEXSCREENER[chain] ?? chain}/${t.address}`,
  };
}

const FRESH_MAX_MINUTES = 360; // 6 jam — di atas ini dianggap "sudah lama", bukan fresh entry lagi.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain") ?? "sol";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30", 10) || 30, 80);
  const types: TrenchesType[] = (searchParams.get("types")?.split(",") as TrenchesType[]) ?? [
    "near_completion",
    "completed",
  ];

  try {
    // filter-preset "smart-money" upstream (min_smart_degen_count=1) + preset
    // "safe" (rug/bundler/insider < 0.3) sekaligus, biar hemat kuota request
    // (server yang nyaring, bukan kita nge-loop banyak call).
    const data = await getTrenches(chain, types, {
      min_smart_degen_count: 1,
      max_rug_ratio: 0.3,
      max_bundler_rate: 0.3,
      max_insider_ratio: 0.3,
    }, limit);

    const merged = [
      ...(data.new_creation ?? []).map((t) => ({ ...t, _stage: "new_creation" })),
      ...(data.near_completion ?? []).map((t) => ({ ...t, _stage: "near_completion" })),
      ...(data.completed ?? []).map((t) => ({ ...t, _stage: "completed" })),
    ].filter((t) => types.includes(t._stage));

    const screened = merged
      .filter(passesScreen)
      .sort((a, b) => (b.smart_degen_count ?? 0) - (a.smart_degen_count ?? 0))
      .map((t) => ({ ...toResultItem(t, chain), stage: t._stage }));

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      chain,
      candidatePool: merged.length,
      passedScreen: screened.length,
      usage: getGmgnUsage(),
      results: screened,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 502 });
  }
}
