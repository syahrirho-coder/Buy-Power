// PENTING: DexScreener API publik TIDAK punya endpoint candle/OHLCV sama
// sekali (sudah dicek di docs.dexscreener.com/api/reference) — cuma
// snapshot pair (harga sekarang, volume, liquidity, dll). Jadi di sini
// DexScreener cuma dipakai untuk 2 hal: (1) nemuin/nyari token memecoin,
// dan (2) bikin link langsung ke halaman chart DexScreener-nya.
// Rate limit: 300 req/menit endpoint pair, 60 req/menit endpoint
// profile/boost.

export type DexPair = {
  chainId: string; // "solana" | "ethereum" | "bsc" | "base" | ...
  dexId: string; // "raydium" | "pumpfun" | "pumpswap" | "uniswap" | ...
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  url: string; // link resmi dexscreener utk pair ini
  info?: { imageUrl?: string };
};

const DS_BASE = "https://api.dexscreener.com";

// Chain id DexScreener -> network slug GeckoTerminal. Beda penamaan di
// kedua API ini, jadi harus dipetakan manual.
export const DEXSCREENER_TO_GECKOTERMINAL: Record<string, string> = {
  solana: "solana",
  ethereum: "eth",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon_pos",
  avalanche: "avax",
  optimism: "optimism",
  blast: "blast",
  sui: "sui-network",
  ton: "ton",
  tron: "tron",
};

export function isPumpFunPair(p: DexPair): boolean {
  return p.dexId.toLowerCase().includes("pump");
}

export function dexscreenerPairUrl(p: DexPair): string {
  return p.url || `https://dexscreener.com/${p.chainId}/${p.pairAddress}`;
}

export function geckoterminalPoolUrl(p: DexPair): string | null {
  const network = DEXSCREENER_TO_GECKOTERMINAL[p.chainId];
  if (!network) return null;
  return `https://www.geckoterminal.com/${network}/pools/${p.pairAddress}`;
}

async function dsGet(path: string): Promise<any> {
  const res = await fetch(`${DS_BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`DexScreener ${path}: ${res.status}`);
  return res.json();
}

/** Token yang lagi di-boost (bayar promosi) — sinyal "lagi rame diomongin". */
export async function fetchBoostedTokens(chain?: string): Promise<
  { chainId: string; tokenAddress: string; icon?: string }[]
> {
  const rows: any[] = await dsGet("/token-boosts/latest/v1");
  return rows
    .filter((r) => !chain || r.chainId === chain)
    .map((r) => ({ chainId: r.chainId, tokenAddress: r.tokenAddress, icon: r.icon }));
}

/** Token profile terbaru — mencakup token baru (termasuk yang baru lulus pump.fun). */
export async function fetchLatestProfiles(chain?: string): Promise<
  { chainId: string; tokenAddress: string; icon?: string }[]
> {
  const rows: any[] = await dsGet("/token-profiles/latest/v1");
  return rows
    .filter((r) => !chain || r.chainId === chain)
    .map((r) => ({ chainId: r.chainId, tokenAddress: r.tokenAddress, icon: r.icon }));
}

/** Enrich satu token address jadi daftar pair (harga, liquidity, dexId, dll). */
export async function fetchPairsForToken(chainId: string, tokenAddress: string): Promise<DexPair[]> {
  const json = await dsGet(`/tokens/v1/${chainId}/${tokenAddress}`);
  const pairs: any[] = Array.isArray(json) ? json : json?.pairs ?? [];
  return pairs;
}

/** Cari token/pair by nama, simbol, atau contract address — semua chain. */
export async function searchPairs(query: string): Promise<DexPair[]> {
  const json = await dsGet(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  return json?.pairs ?? [];
}

/**
 * Watchlist token memecoin lama/besar yang sudah "settle" (bukan lagi
 * fase baru launch) — feed boosted/profiles di atas nyaris tidak pernah
 * menampilkan token-token ini lagi karena mereka jarang re-boost.
 * Di-resolve lewat search (bukan hardcode contract address) supaya tidak
 * salah alamat kalau ingatan simbol->address meleset.
 * Silakan tambah/ubah daftar simbol sesuai kebutuhan.
 */
export const LEGACY_MEMECOIN_WATCHLIST = [
  "BONK",
  "WIF",
  "PEPE",
  "SHIB",
  "DOGE",
  "FLOKI",
  "POPCAT",
  "MEW",
  "BOME",
  "BRETT",
  "MOG",
  "PENGU",
  "TRUMP",
  "TURBO",
  "WOJAK",
];

/** Ambil pair terlikuid untuk tiap simbol di watchlist, filter chain kalau diminta. */
export async function fetchLegacyWatchlist(chain?: string): Promise<DexPair[]> {
  const results = await Promise.all(
    LEGACY_MEMECOIN_WATCHLIST.map(async (sym) => {
      try {
        const pairs = await searchPairs(sym);
        const filtered = chain ? pairs.filter((p) => p.chainId === chain) : pairs;
        // Cocokkan simbol persis (case-insensitive) biar tidak ke-mix token lain
        // yang cuma namanya mengandung kata sama.
        const exact = filtered.filter((p) => p.baseToken.symbol.toUpperCase() === sym);
        const pool = exact.length ? exact : filtered;
        if (!pool.length) return null;
        return pool.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
      } catch {
        return null;
      }
    })
  );
  return results.filter((p): p is DexPair => p !== null);
}

/**
 * Kumpulan pair memecoin buat discovery: gabungan boosted + new profiles,
 * di-enrich jadi data pair penuh, dipilih pair paling likuid per token,
 * lalu diurutkan volume 24h desc. `chain` opsional ("solana" default
 * karena mayoritas pump.fun/memecoin baru ada di sana; kosongkan untuk
 * semua chain).
 */
export async function discoverMemecoins(opts: {
  chain?: string;
  limit?: number;
  includeLegacy?: boolean;
}): Promise<DexPair[]> {
  const { chain, limit = 40, includeLegacy = true } = opts;
  const [boosted, profiles] = await Promise.all([
    fetchBoostedTokens(chain).catch(() => []),
    fetchLatestProfiles(chain).catch(() => []),
  ]);

  const seen = new Map<string, { chainId: string; tokenAddress: string }>();
  for (const t of [...boosted, ...profiles]) {
    seen.set(`${t.chainId}:${t.tokenAddress}`, t);
  }

  const tokenList = Array.from(seen.values()).slice(0, limit);

  const [enriched, legacy] = await Promise.all([
    Promise.all(
      tokenList.map(async (t) => {
        try {
          return await fetchPairsForToken(t.chainId, t.tokenAddress);
        } catch {
          return [] as DexPair[];
        }
      })
    ),
    includeLegacy ? fetchLegacyWatchlist(chain).catch(() => []) : Promise.resolve([]),
  ]);

  const best: DexPair[] = [...legacy];
  const seenPair = new Set(legacy.map((p) => `${p.chainId}:${p.pairAddress}`));
  for (const pairs of enriched) {
    if (!pairs.length) continue;
    // Ambil pair dgn likuiditas terbesar sebagai representasi token ini.
    const top = pairs.reduce((a, b) =>
      (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a
    );
    const key = `${top.chainId}:${top.pairAddress}`;
    if (!seenPair.has(key)) {
      seenPair.add(key);
      best.push(top);
    }
  }

  return best.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
}
