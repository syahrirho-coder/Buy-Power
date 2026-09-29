// Etherscan API V2 (unified multichain) — https://docs.etherscan.io/etherscan-v2
// SATU API key berlaku untuk semua chain EVM yang didukung, tinggal ganti
// `chainid` di query. Daftar & ambil key gratis di https://etherscan.io/apis.
//
// ROTASI 5 KEY: isi ETHERSCAN_API_KEYS=key1,...,key5 (ETHERSCAN_API_KEY lama
// tetap jalan & digabung ke pool). Tier gratis dibatasi request/detik dan
// request/hari PER KEY, jadi tiap key di-throttle sendiri (default 350ms) dan
// kalau kena limit / key invalid, otomatis pindah ke key lain.
import { KeyPoolError, createKeyPool } from "@/lib/key-pool";

const HOST = "https://api.etherscan.io/v2/api";

const etherscanKeys = createKeyPool({
  name: "Etherscan",
  listEnv: "ETHERSCAN_API_KEYS",
  singleEnv: "ETHERSCAN_API_KEY",
  maxKeys: 5,
  minGapMs: Number(process.env.ETHERSCAN_MIN_GAP_MS) || 350,
  dailyBudget: Number(process.env.ETHERSCAN_DAILY_REQUESTS_PER_KEY) || 90_000, // free = 100k/hari, sisakan buffer
  signupHint: "Daftar gratis di https://etherscan.io/apis",
});

export const getEtherscanUsage = etherscanKeys.usage;
export const etherscanKeyCount = etherscanKeys.keyCount;

/**
 * 1 panggilan Etherscan V2 dengan rotasi key. Limit per-detik / per-hari /
 * key invalid dari Etherscan datang sebagai HTTP 200 + status "0" + teks di
 * `result`, jadi dideteksi dari teksnya lalu dirotasi ke key lain.
 */
async function etherscanGet(params: Record<string, string>, label: string): Promise<any[]> {
  return etherscanKeys.withKey(async (apikey) => {
    const qs = new URLSearchParams({ ...params, apikey });
    const res = await fetch(`${HOST}?${qs.toString()}`);
    if (res.status === 429 || res.status >= 500) {
      throw new KeyPoolError(`Etherscan ${label}: HTTP ${res.status}`, { rotate: true, cooldownMs: 15_000 });
    }
    const json: any = await res.json();
    if (json.status !== "1") {
      const msg = String(json.result ?? json.message ?? "unknown error");
      // "No transactions found" itu kondisi normal (token/wallet sepi), bukan error.
      if (String(json.message ?? "").toLowerCase().includes("no transactions")) return [];
      if (/max daily|daily rate limit/i.test(msg)) {
        throw new KeyPoolError(`Etherscan ${label}: ${msg}`, { rotate: true, cooldownMs: 60 * 60_000 });
      }
      if (/rate limit|max calls per sec|too many/i.test(msg)) {
        throw new KeyPoolError(`Etherscan ${label}: ${msg}`, { rotate: true, cooldownMs: 3_000 });
      }
      if (/invalid api key|missing.*api key|api key.*(invalid|not found)/i.test(msg)) {
        throw new KeyPoolError(`Etherscan ${label}: ${msg}`, { rotate: true, cooldownMs: 60 * 60_000 });
      }
      throw new Error(`Etherscan ${label} gagal: ${json.message ?? msg}`);
    }
    return Array.isArray(json.result) ? json.result : [];
  });
}

const CHAIN_IDS: Record<string, number> = {
  eth: 1,
  bsc: 56,
  base: 8453,
};

export function supportsChain(chain: string): boolean {
  return chain in CHAIN_IDS;
}

export type NormalizedTransfer = {
  wallet: string;
  tokenAddress: string;
  tokenSymbol: string;
  timestamp: number;
  direction: "in" | "out";
};

export type EvmHolderCandidate = { address: string; amount: number };

/**
 * GRATIS (sama seperti getWalletTokenTransfers, cuma butuh ETHERSCAN_API_KEY
 * yang gratis daftar) — dipakai buat DISCOVER dompet dari 1 token, mirip
 * peran Solscan token holders di chain "sol". Caranya: tarik daftar transfer
 * terakhir dari kontrak token itu (query by `contractaddress`, TANPA
 * `address` — endpoint publik Etherscan V2, bukan fitur Pro), lalu hitung
 * alamat penerima ("to") yang paling sering & paling banyak menerima —
 * itu jadi kandidat "wallet aktif beli token ini", pengganti GMGN top
 * traders kalau GMGN_API_KEY tidak di-set.
 */
export async function getTokenTransferCandidates(
  chain: string,
  tokenAddress: string,
  limit = 20
): Promise<EvmHolderCandidate[]> {
  const chainid = CHAIN_IDS[chain];
  if (!chainid) return [];

  const rows = await etherscanGet(
    {
      chainid: String(chainid),
      module: "account",
      action: "tokentx",
      contractaddress: tokenAddress,
      sort: "desc",
      page: "1",
      offset: "500", // tarik sampel transfer lebih banyak biar ranking-nya representatif
    },
    `tokentx (${chain})`
  );
  const tally = new Map<string, number>();
  for (const r of rows) {
    const to = String(r.to ?? "").toLowerCase();
    if (!to) continue;
    const decimals = Number(r.tokenDecimal ?? 18) || 18;
    const value = Number(r.value ?? 0) / 10 ** decimals;
    tally.set(to, (tally.get(to) ?? 0) + value);
  }

  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([address, amount]) => ({ address, amount }));
}

/**
 * GET tokentx — daftar transfer token (ERC-20) yang melibatkan 1 wallet, di
 * chain EVM apapun yang didukung Etherscan V2. Ini sumber yang dipakai buat
 * lihat token apa aja yang baru masuk ke wallet (dianggap "beli"/terima).
 */
export async function getWalletTokenTransfers(
  chain: string,
  wallet: string,
  limit = 20
): Promise<NormalizedTransfer[]> {
  const chainid = CHAIN_IDS[chain];
  if (!chainid) throw new Error(`Chain '${chain}' tidak didukung sumber Etherscan`);

  const rows = await etherscanGet(
    {
      chainid: String(chainid),
      module: "account",
      action: "tokentx",
      address: wallet,
      sort: "desc",
      page: "1",
      offset: String(limit),
    },
    `tokentx (${chain})`
  );

  return rows
    .map((r) => ({
      wallet,
      tokenAddress: String(r.contractAddress ?? "").toLowerCase(),
      tokenSymbol: r.tokenSymbol ?? "?",
      timestamp: Number(r.timeStamp ?? Math.floor(Date.now() / 1000)),
      direction: (String(r.to ?? "").toLowerCase() === wallet.toLowerCase() ? "in" : "out") as "in" | "out",
    }))
    .filter((r) => r.tokenAddress);
}
