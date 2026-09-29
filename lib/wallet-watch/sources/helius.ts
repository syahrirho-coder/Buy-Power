// Sumber data Solana lewat Helius — VERSI HEMAT + rotasi banyak API key.
//
// Perubahan dari versi lama:
// - Key diambil dari pool (helius-keys.ts): HELIUS_API_KEYS=k1,k2,k3,k4,k5,
//   dipilih otomatis (paling sedikit dipakai) + failover kalau 429/401/403.
// - Deteksi pembelian wallet TIDAK lagi pakai Enhanced Transactions API
//   (100 credit/request). Sekarang: getSignaturesForAddress (1 credit) +
//   getTransaction jsonParsed per tx baru (1 credit) lalu diparse sendiri
//   (helius-parse.ts). Hasil per tx di-cache (tx immutable) sehingga scan
//   ulang wallet yang sama hampir gratis.
// - Holder token (DAS getTokenAccounts, 10 credit) di-cache 10 menit per mint.
//
// Fungsi di file ini SENGAJA throw kalau gagal supaya pesan error aslinya
// tampil di chip status UI.
import { mapWithConcurrency } from "@/lib/concurrency";
import { HeliusHttpError, withHeliusKey } from "@/lib/wallet-watch/sources/helius-keys";
import { parseBoughtMints } from "@/lib/wallet-watch/sources/helius-parse";

const RPC_URL = "https://mainnet.helius-rpc.com";

const HOLDERS_TTL_MS = 10 * 60_000;
const WALLET_TTL_MS = 45_000;
const MAX_SIGS_PER_WALLET = 25; // batas keras biar 1 scan tidak boros credit
const TX_CACHE_MAX = 5000;

async function rpc(kind: "rpc" | "das", label: string, method: string, params: unknown): Promise<any> {
  return withHeliusKey(kind, async (key) => {
    const res = await fetch(`${RPC_URL}/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: label, method, params }),
    });
    const text = await res.text();
    if (!res.ok) throw new HeliusHttpError(res.status, `Helius ${label} HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new HeliusHttpError(502, `Helius ${label}: respons bukan JSON`);
    }
    if (json.error) {
      const msg = String(json.error.message ?? JSON.stringify(json.error));
      // JSON-RPC error yang sebenarnya rate limit / kuota -> perlakukan sbg 429 (pindah key)
      const status = /rate|limit|credit|quota|too many/i.test(msg) ? 429 : 400;
      throw new HeliusHttpError(status, `Helius ${label}: ${msg}`);
    }
    return json.result;
  });
}

export type SolanaHolder = { address: string; amount: number };

const holdersCache = new Map<string, { at: number; rows: SolanaHolder[] }>();

/** Holder terbesar 1 token Solana (owner, bukan token account). 10 credit, cache 10 menit. Throws kalau gagal. */
export async function getSolanaTokenHolders(tokenAddress: string, limit = 20): Promise<SolanaHolder[]> {
  const hit = holdersCache.get(tokenAddress);
  if (hit && Date.now() - hit.at < HOLDERS_TTL_MS) return hit.rows.slice(0, limit);

  const result = await rpc("das", "getTokenAccounts", "getTokenAccounts", {
    mint: tokenAddress,
    page: 1,
    limit: 1000,
  });
  const rows: any[] = result?.token_accounts ?? [];
  // 1 owner bisa punya >1 token account: jumlahkan dulu, baru ranking.
  const tally = new Map<string, number>();
  for (const r of rows) {
    const owner = String(r.owner ?? "");
    if (!owner) continue;
    tally.set(owner, (tally.get(owner) ?? 0) + Number(r.amount ?? 0));
  }
  const sorted = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([address, amount]) => ({ address, amount }));
  holdersCache.set(tokenAddress, { at: Date.now(), rows: sorted });
  return sorted.slice(0, limit);
}

export type SolanaTransfer = {
  wallet: string;
  tokenAddress: string;
  tokenSymbol: string;
  timestamp: number;
};

// Cache hasil parse per (wallet, signature): tx immutable, jadi aman disimpan.
const txCache = new Map<string, { mints: string[]; ts: number }>();
const walletCache = new Map<string, { at: number; rows: SolanaTransfer[] }>();

/**
 * Token yang DIBELI wallet dari transaksi terbaru. Biaya: 1 credit
 * (getSignaturesForAddress) + 1 credit per tx yang belum pernah diparse.
 * Throws kalau gagal.
 */
export async function getSolanaAccountTokenTransfers(wallet: string, limit = 20): Promise<SolanaTransfer[]> {
  const n = Math.min(Math.max(limit, 1), MAX_SIGS_PER_WALLET);
  const cached = walletCache.get(wallet);
  if (cached && Date.now() - cached.at < WALLET_TTL_MS) return cached.rows;

  const sigs: any[] = await rpc("rpc", "getSignaturesForAddress", "getSignaturesForAddress", [
    wallet,
    { limit: n, commitment: "confirmed" },
  ]);
  if (!Array.isArray(sigs)) throw new Error("Helius getSignaturesForAddress: bentuk respons tidak dikenali");

  const okSigs = sigs.filter((s) => s?.signature && !s.err);
  const fresh = okSigs.filter((s) => !txCache.has(`${wallet}:${s.signature}`));

  // concurrency kecil: throttle per key sudah menjaga limit, ini cuma biar tidak numpuk
  await mapWithConcurrency(fresh, 3, async (s) => {
    const cacheKey = `${wallet}:${s.signature}`;
    const tx = await rpc("rpc", "getTransaction", "getTransaction", [
      s.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);
    const ts = Number(tx?.blockTime ?? s.blockTime ?? Math.floor(Date.now() / 1000));
    if (txCache.size >= TX_CACHE_MAX) txCache.delete(txCache.keys().next().value as string);
    txCache.set(cacheKey, { mints: tx ? parseBoughtMints(tx, wallet) : [], ts });
  });

  const out: SolanaTransfer[] = [];
  for (const s of okSigs) {
    const c = txCache.get(`${wallet}:${s.signature}`);
    if (!c) continue;
    for (const mint of c.mints) out.push({ wallet, tokenAddress: mint, tokenSymbol: "?", timestamp: c.ts });
  }
  walletCache.set(wallet, { at: Date.now(), rows: out });
  return out;
}
