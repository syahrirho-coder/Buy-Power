// Parser murni (tanpa import/network) — baca 1 transaksi hasil RPC getTransaction
// (encoding jsonParsed) dan cari token yang MASUK ke wallet sebagai hasil BELI.
//
// Kenapa bukan Enhanced Transactions API: itu 100 credit/request, sedangkan
// getTransaction cuma 1 credit dan formatnya standar Solana (stabil).
//
// Definisi "beli": saldo token X milik wallet naik, DAN wallet membayar sesuatu
// di transaksi yang sama (SOL turun > 0.001, atau SOL-terbungkus/USDC/USDT turun).
// Transfer masuk gratis (airdrop / kiriman dari wallet lain) tidak dihitung.

export const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const MIN_SOL_SPENT_LAMPORTS = 1_000_000n; // 0.001 SOL, di atas fee biasa

function toBig(v: unknown): bigint {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
}

function sumByMint(balances: any[] | null | undefined, wallet: string): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const b of balances ?? []) {
    if (String(b?.owner ?? "") !== wallet) continue;
    const mint = String(b?.mint ?? "");
    if (!mint) continue;
    m.set(mint, (m.get(mint) ?? 0n) + toBig(b?.uiTokenAmount?.amount));
  }
  return m;
}

/** Mint token (non-quote) yang bertambah di wallet + ada pembayaran. Kosong kalau bukan pembelian / tx gagal. */
export function parseBoughtMints(tx: any, wallet: string): string[] {
  const meta = tx?.meta;
  if (!meta || meta.err) return [];

  const pre = sumByMint(meta.preTokenBalances, wallet);
  const post = sumByMint(meta.postTokenBalances, wallet);

  // 1) sisi bayar
  let paid = false;
  const keys: any[] = tx?.transaction?.message?.accountKeys ?? [];
  const idx = keys.findIndex((k) => String(k?.pubkey ?? k) === wallet);
  if (idx >= 0 && Array.isArray(meta.preBalances) && Array.isArray(meta.postBalances)) {
    const delta = toBig(meta.postBalances[idx]) - toBig(meta.preBalances[idx]);
    if (delta <= -MIN_SOL_SPENT_LAMPORTS) paid = true;
  }
  if (!paid) {
    for (const q of QUOTE_MINTS) {
      if ((post.get(q) ?? 0n) < (pre.get(q) ?? 0n)) {
        paid = true;
        break;
      }
    }
  }
  if (!paid) return [];

  // 2) sisi terima
  const out: string[] = [];
  for (const [mint, after] of post) {
    if (QUOTE_MINTS.has(mint)) continue;
    if (after > (pre.get(mint) ?? 0n)) out.push(mint);
  }
  return out;
}
