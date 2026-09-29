import { getTopTraders, getWalletActivity } from "@/lib/gmgn/client";
import { mapWithConcurrency } from "@/lib/concurrency";
import * as helius from "@/lib/wallet-watch/sources/helius";
import * as etherscan from "@/lib/wallet-watch/sources/etherscan";

// Alamat Solana (base58) CASE-SENSITIVE — di-lowercase jadi alamat rusak
// (API balikin error/kosong, link pump.fun & CA salinan salah). Hanya alamat
// EVM yang aman di-lowercase.
const norm = (chain: string, addr: string): string => (chain === "sol" ? addr : addr.toLowerCase());

export type WalletCandidate = {
  address: string;
  rank: number;
  buyVolumeUsd: number;
  sources: string[]; // "gmgn" dan/atau "helius"/"etherscan" — dari mana wallet ini ketemu
};

/** Status 1 sumber data — dipakai buat nunjukin ke UI KENAPA hasil kosong (bukan cuma diam-diam kosong). */
export type SourceStatus = {
  source: "gmgn" | "helius" | "etherscan";
  ok: boolean; // true = minimal 1 call ke sumber ini sukses
  found: number; // total wallet/sighting yang ketemu dari sumber ini
  error: string | null; // pesan error asli (kalau ok=false) — biasanya alasan sinyal kosong
  skipped: boolean; // true kalau sumber ini memang tidak dipanggil (mis. chain tidak didukung)
};

/**
 * Cari sampai `limit` dompet yang terkait 1 token, digabung dari beberapa
 * sumber otomatis — SEMUA GRATIS (tidak wajib GMGN_API_KEY berbayar):
 * - GMGN top traders (semua chain) — kalau GMGN_API_KEY di-set, ada volume
 *   beli. Kalau tidak di-set/gagal, sumber ini otomatis kosong (bukan error
 *   fatal buat discovery, tapi statusnya tetap dilaporkan ke caller).
 * - Helius token holders (khusus chain "sol") — butuh HELIUS_API_KEY (tier
 *   gratis tersedia); pengganti Solscan yang endpoint publiknya sudah mati (lihat
 *   catatan di sources/helius.ts).
 * - Etherscan token transfer candidates (chain "eth"/"bsc"/"base") — publik,
 *   cuma butuh ETHERSCAN_API_KEY gratis, ranking penerima transfer terakhir
 *   jadi kandidat wallet.
 * Dompet yang sama dari >1 sumber di-dedupe dan digabung `sources`-nya
 * (semakin banyak sumber yang independen setuju, semakin worth dipantau).
 */
export async function discoverWallets(
  chain: string,
  tokenAddress: string,
  limit = 20
): Promise<{ wallets: WalletCandidate[]; sourceStatus: SourceStatus[] }> {
  const sourceStatus: SourceStatus[] = [];

  let gmgnTraders: any[] = [];
  try {
    gmgnTraders = await getTopTraders(chain, tokenAddress, 100);
    sourceStatus.push({ source: "gmgn", ok: true, found: gmgnTraders.length, error: null, skipped: false });
  } catch (e: any) {
    sourceStatus.push({ source: "gmgn", ok: false, found: 0, error: e.message ?? String(e), skipped: false });
  }
  const gmgnWallets = gmgnTraders
    .filter((t: any) => (t.addr_type ?? 0) === 0)
    .map((t: any) => ({
      address: norm(chain, t.wallet_address ?? t.address ?? t.maker ?? ""),
      buyVolumeUsd: t.buy_volume_cur ?? 0,
    }))
    .filter((w: { address: string }) => w.address);

  let heliusHolders: helius.SolanaHolder[] = [];
  if (chain === "sol") {
    try {
      heliusHolders = await helius.getSolanaTokenHolders(tokenAddress, limit);
      sourceStatus.push({ source: "helius", ok: true, found: heliusHolders.length, error: null, skipped: false });
    } catch (e: any) {
      sourceStatus.push({ source: "helius", ok: false, found: 0, error: e.message ?? String(e), skipped: false });
    }
  } else {
    sourceStatus.push({ source: "helius", ok: false, found: 0, error: null, skipped: true });
  }

  let etherscanHolders: etherscan.EvmHolderCandidate[] = [];
  if (chain !== "sol" && etherscan.supportsChain(chain)) {
    try {
      etherscanHolders = await etherscan.getTokenTransferCandidates(chain, tokenAddress, limit);
      sourceStatus.push({ source: "etherscan", ok: true, found: etherscanHolders.length, error: null, skipped: false });
    } catch (e: any) {
      sourceStatus.push({ source: "etherscan", ok: false, found: 0, error: e.message ?? String(e), skipped: false });
    }
  } else {
    sourceStatus.push({ source: "etherscan", ok: false, found: 0, error: null, skipped: true });
  }

  const merged = new Map<string, WalletCandidate>();
  for (const w of gmgnWallets) {
    merged.set(w.address, {
      address: w.address,
      rank: 0,
      buyVolumeUsd: w.buyVolumeUsd,
      sources: ["gmgn"],
    });
  }
  for (const h of heliusHolders) {
    const addr = norm(chain, h.address);
    const existing = merged.get(addr);
    if (existing) {
      existing.sources.push("helius");
    } else {
      merged.set(addr, { address: addr, rank: 0, buyVolumeUsd: 0, sources: ["helius"] });
    }
  }
  for (const h of etherscanHolders) {
    const addr = norm(chain, h.address);
    const existing = merged.get(addr);
    if (existing) {
      existing.sources.push("etherscan");
    } else {
      merged.set(addr, { address: addr, rank: 0, buyVolumeUsd: 0, sources: ["etherscan"] });
    }
  }

  const wallets = [...merged.values()]
    .sort((a, b) => {
      // dompet yang muncul di >1 sumber independen didahulukan, baru volume beli.
      if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
      return b.buyVolumeUsd - a.buyVolumeUsd;
    })
    .slice(0, limit)
    .map((w, i) => ({ ...w, rank: i + 1 }));

  return { wallets, sourceStatus };
}

export type TokenSighting = {
  wallet: string;
  tokenAddress: string;
  tokenSymbol: string;
  side: "buy" | "sell";
  timestamp: number;
  source: string;
};

// Lihat catatan di getWalletActivity (lib/gmgn/client.ts) soal field mentah
// yang belum 100% pasti — semua akses field di bawah pakai fallback berlapis.
function normalizeGmgnActivity(chain: string, wallet: string, raw: any): TokenSighting | null {
  const tokenAddress: string | undefined =
    raw?.token?.address ?? raw?.token_address ?? raw?.tokenAddress;
  if (!tokenAddress) return null;
  const tokenSymbol: string = raw?.token?.symbol ?? raw?.token_symbol ?? raw?.tokenSymbol ?? "?";
  const eventType = String(raw?.event_type ?? raw?.type ?? raw?.side ?? "buy").toLowerCase();
  const side: "buy" | "sell" = eventType.includes("sell") ? "sell" : "buy";
  const rawTs = raw?.timestamp ?? raw?.ts ?? raw?.time;
  const timestamp = rawTs ? Number(rawTs) : Math.floor(Date.now() / 1000);
  return { wallet, tokenAddress: norm(chain, tokenAddress), tokenSymbol, side, timestamp, source: "gmgn" };
}

type WalletSightingResult = {
  sightings: TokenSighting[];
  gmgn: { ok: boolean; found: number; error: string | null };
  chainSource: { name: "helius" | "etherscan" | null; ok: boolean; found: number; error: string | null };
};

/**
 * Kumpulkan sinyal "token masuk ke wallet ini baru-baru ini" dari SEMUA
 * sumber yang relevan buat 1 chain sekaligus, biar tidak bergantung ke 1 API
 * doang:
 * - Semua chain: coba GMGN wallet_activity (best-effort — field belum 100%
 *   pasti, lihat catatan di client.ts).
 * - chain "sol": tambah riwayat transaksi Helius (butuh HELIUS_API_KEY,
 *   lihat catatan di sources/helius.ts).
 * - chain "eth"/"bsc"/"base": tambah Etherscan tokentx (butuh
 *   ETHERSCAN_API_KEY, tapi paling stabil & terdokumentasi resmi dari semua
 *   sumber di sini).
 * Kalau 1 sumber gagal/rate-limit, sumber lain tetap jalan — hasil scan
 * tidak nol total gara-gara 1 API down. Error asli tiap sumber tetap
 * DIKEMBALIKAN (bukan ditelan diam-diam) supaya scanWallets bisa
 * agregasi-nya jadi status yang kelihatan di UI.
 */
async function getWalletSightings(chain: string, wallet: string, limitPerWallet: number): Promise<WalletSightingResult> {
  const gmgnPromise = getWalletActivity(chain, wallet, limitPerWallet)
    .then((raw) => {
      const sightings = raw.map((r) => normalizeGmgnActivity(chain, wallet, r)).filter((s): s is TokenSighting => s !== null);
      return { sightings, status: { ok: true, found: sightings.length, error: null as string | null } };
    })
    .catch((e: any) => ({ sightings: [] as TokenSighting[], status: { ok: false, found: 0, error: e.message ?? String(e) } }));

  let chainPromise: Promise<{
    sightings: TokenSighting[];
    name: "helius" | "etherscan" | null;
    status: { ok: boolean; found: number; error: string | null };
  }>;

  if (chain === "sol") {
    chainPromise = helius
      .getSolanaAccountTokenTransfers(wallet, limitPerWallet)
      .then((rows) => {
        const sightings = rows.map((r) => ({
          wallet: r.wallet,
          tokenAddress: norm(chain, r.tokenAddress),
          tokenSymbol: r.tokenSymbol,
          side: "buy" as const, // splTransfers publik tidak bedain arah in/out dengan jelas
          timestamp: r.timestamp,
          source: "helius",
        }));
        return { sightings, name: "helius" as const, status: { ok: true, found: sightings.length, error: null } };
      })
      .catch((e: any) => ({
        sightings: [],
        name: "helius" as const,
        status: { ok: false, found: 0, error: e.message ?? String(e) },
      }));
  } else if (etherscan.supportsChain(chain)) {
    chainPromise = etherscan
      .getWalletTokenTransfers(chain, wallet, limitPerWallet)
      .then((rows) => {
        const sightings = rows
          .filter((r) => r.direction === "in")
          .map((r) => ({
            wallet: r.wallet,
            tokenAddress: r.tokenAddress,
            tokenSymbol: r.tokenSymbol,
            side: "buy" as const,
            timestamp: r.timestamp,
            source: "etherscan",
          }));
        return { sightings, name: "etherscan" as const, status: { ok: true, found: sightings.length, error: null } };
      })
      .catch((e: any) => ({
        sightings: [],
        name: "etherscan" as const,
        status: { ok: false, found: 0, error: e.message ?? String(e) },
      }));
  } else {
    chainPromise = Promise.resolve({ sightings: [], name: null, status: { ok: false, found: 0, error: null } });
  }

  const [gmgnResult, chainResult] = await Promise.all([gmgnPromise, chainPromise]);
  const sightings = [...gmgnResult.sightings, ...chainResult.sightings].filter((s) => s.side === "buy");

  return {
    sightings,
    gmgn: gmgnResult.status,
    chainSource: { name: chainResult.name, ...chainResult.status },
  };
}

export type WalletSignal = {
  tokenAddress: string;
  tokenSymbol: string;
  wallets: string[];
  sources: string[];
};

/**
 * Full-auto: scan SEMUA dompet yang dikasih (biasanya = semua hasil
 * discoverWallets, tanpa perlu user pilih manual), cari token yang dibeli
 * oleh >= minWalletsForSignal dompet independen dalam window aktivitas
 * terbaru — itu yang jadi "sinyal". Concurrency dibatasi (default 4
 * dompet bersamaan) biar tidak kena rate limit walau dompetnya banyak.
 *
 * Kalau `signals` selalu kosong padahal `wallets` banyak, cek `sourceStatus`
 * di hasilnya dulu — itu nunjukin persis sumber mana yang gagal dan
 * kenapa (paling sering: GMGN_API_KEY belum di-set/salah, atau endpoint
 * HELIUS_API_KEY belum di-set). `sightings` kosong = memang belum ada
 * sumber manapun yang berhasil ambil data aktivitas beli.
 */
export async function scanWallets(
  chain: string,
  wallets: string[],
  opts: { limitPerWallet?: number; minWalletsForSignal?: number; concurrency?: number } = {}
): Promise<{ sightings: TokenSighting[]; signals: WalletSignal[]; sourceStatus: SourceStatus[] }> {
  const limitPerWallet = opts.limitPerWallet ?? 12;
  const minWalletsForSignal = opts.minWalletsForSignal ?? 3;
  const concurrency = opts.concurrency ?? 4;

  const perWallet = await mapWithConcurrency(wallets, concurrency, (w) => getWalletSightings(chain, w, limitPerWallet));

  const sightings = perWallet.flatMap((r) => r.sightings).sort((a, b) => b.timestamp - a.timestamp);

  // Agregasi status per sumber di semua dompet: ok kalau MINIMAL 1 call
  // sukses, error yang ditampilkan = contoh pesan error terakhir yang ketemu.
  const gmgnAgg = { ok: false, found: 0, error: null as string | null };
  let chainName: "helius" | "etherscan" | null = null;
  const chainAgg = { ok: false, found: 0, error: null as string | null };
  let chainSkipped = true;

  for (const r of perWallet) {
    if (r.gmgn.ok) gmgnAgg.ok = true;
    gmgnAgg.found += r.gmgn.found;
    if (r.gmgn.error && !gmgnAgg.error) gmgnAgg.error = r.gmgn.error;

    if (r.chainSource.name) {
      chainName = r.chainSource.name;
      chainSkipped = false;
      if (r.chainSource.ok) chainAgg.ok = true;
      chainAgg.found += r.chainSource.found;
      if (r.chainSource.error && !chainAgg.error) chainAgg.error = r.chainSource.error;
    }
  }

  const sourceStatus: SourceStatus[] = [
    { source: "gmgn", ok: gmgnAgg.ok, found: gmgnAgg.found, error: gmgnAgg.error, skipped: wallets.length === 0 },
  ];
  if (!chainSkipped && chainName) {
    sourceStatus.push({ source: chainName, ok: chainAgg.ok, found: chainAgg.found, error: chainAgg.error, skipped: false });
  } else {
    sourceStatus.push({
      source: chain === "sol" ? "helius" : "etherscan",
      ok: false,
      found: 0,
      error: null,
      skipped: true,
    });
  }

  const byToken = new Map<string, { tokenSymbol: string; wallets: Set<string>; sources: Set<string> }>();
  for (const s of sightings) {
    const entry =
      byToken.get(s.tokenAddress) ?? { tokenSymbol: s.tokenSymbol, wallets: new Set<string>(), sources: new Set<string>() };
    entry.wallets.add(s.wallet);
    entry.sources.add(s.source);
    byToken.set(s.tokenAddress, entry);
  }

  const signals: WalletSignal[] = [...byToken.entries()]
    .filter(([, v]) => v.wallets.size >= minWalletsForSignal)
    .map(([tokenAddress, v]) => ({
      tokenAddress,
      tokenSymbol: v.tokenSymbol,
      wallets: [...v.wallets],
      sources: [...v.sources],
    }))
    .sort((a, b) => b.wallets.length - a.wallets.length);

  return { sightings, signals, sourceStatus };
}
