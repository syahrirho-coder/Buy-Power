import { randomUUID } from "crypto";
import { KeyPoolError, createKeyPool } from "@/lib/key-pool";

// GMGN OpenAPI — https://openapi.gmgn.ai. Butuh GMGN_API_KEYS (1-5 key) milik sendiri
// (daftar & apply di https://gmgn.ai/ai). Ini BUKAN API gratis publik
// seperti DexScreener/GeckoTerminal — ada rate limit per tier:
//   Free 5 req/s (burst 5), Plus 20 req/s, Pro 50 req/s.
// Endpoint di sini semua "exist auth" (cuma X-APIKEY + timestamp + client_id
// di query, TANPA signature) — jadi tidak butuh GMGN_PRIVATE_KEY sama
// sekali. Signature/private key cuma diperlukan untuk endpoint trading
// (swap/order/cooking), yang TIDAK dipakai di tab ini.

const HOST = "https://openapi.gmgn.ai";

// ROTASI 5 KEY: isi GMGN_API_KEYS=key1,key2,key3,key4,key5 (GMGN_API_KEY lama
// tetap jalan & digabung ke pool). Free tier 5 req/s per key -> jeda 220ms per
// key; dengan 5 key throughput jadi ~5x lipat. Key kena rate limit / invalid
// otomatis cooldown & request diulang ke key lain.
const gmgnKeys = createKeyPool({
  name: "GMGN",
  listEnv: "GMGN_API_KEYS",
  singleEnv: "GMGN_API_KEY",
  maxKeys: 5,
  minGapMs: Number(process.env.GMGN_MIN_GAP_MS) || 220,
  signupHint: "Daftar & ambil API key di https://gmgn.ai/ai",
});

export const getGmgnUsage = gmgnKeys.usage;
export const gmgnKeyCount = gmgnKeys.keyCount;

function buildUrl(path: string, query: Record<string, string | number | string[] | undefined>): string {
  const params = new URLSearchParams();
  params.set("timestamp", String(Math.floor(Date.now() / 1000)));
  params.set("client_id", randomUUID());
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((item) => params.append(k, item));
    else params.set(k, String(v));
  }
  return `${HOST}${path}?${params.toString()}`;
}

async function gmgnGet(path: string, query: Record<string, string | number | string[] | undefined>): Promise<any> {
  return gmgnKeys.withKey(async (key) => {
    const res = await fetch(buildUrl(path, query), {
      headers: { "X-APIKEY": key, "Content-Type": "application/json" },
    });
    return parseGmgnResponse(res, "GET", path);
  });
}

async function gmgnPost(path: string, query: Record<string, string | number | undefined>, body: unknown): Promise<any> {
  return gmgnKeys.withKey(async (key) => {
    const res = await fetch(buildUrl(path, query), {
      method: "POST",
      headers: { "X-APIKEY": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseGmgnResponse(res, "POST", path);
  });
}

async function parseGmgnResponse(res: Response, method: string, path: string): Promise<any> {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // 429 / 401 / 403 / 5xx tanpa body JSON = masalah key/limit -> rotasi ke key lain.
    const bad = res.status === 429 || res.status === 401 || res.status === 403 || res.status >= 500;
    throw new KeyPoolError(`GMGN ${method} ${path}: HTTP ${res.status}, respons bukan JSON`, {
      rotate: bad,
      cooldownMs: res.status === 401 || res.status === 403 ? 60 * 60_000 : undefined,
    });
  }
  if (json.code !== 0) {
    if (json.error === "RATE_LIMIT_EXCEEDED" || json.error === "RATE_LIMIT_BANNED") {
      throw new KeyPoolError(
        `GMGN rate limit tercapai di 1 key. ${json.upgrade_message ?? "Menunggu / pindah ke key lain."}`,
        { rotate: true, cooldownMs: json.error === "RATE_LIMIT_BANNED" ? 10 * 60_000 : 15_000 }
      );
    }
    const msg = String(json.error ?? json.message ?? `code ${json.code}`);
    // Key salah / dicabut -> rotasi & cooldown 1 jam.
    if (res.status === 401 || res.status === 403 || /api.?key|unauthori[sz]ed|forbidden/i.test(msg)) {
      throw new KeyPoolError(`GMGN ${method} ${path} gagal: ${msg}`, { rotate: true, cooldownMs: 60 * 60_000 });
    }
    throw new Error(`GMGN ${method} ${path} gagal: ${msg}`);
  }
  return json.data;
}

export type TrenchesType = "new_creation" | "near_completion" | "completed";

/** POST /v1/trenches — token launchpad (bisa dipakai untuk screening smart-money). */
export async function getTrenches(
  chain: string,
  types: TrenchesType[],
  extraFilters: Record<string, number | string> = {},
  limit = 30
): Promise<Record<string, any[]>> {
  const section = { filters: ["offchain", "onchain"], launchpad_platform_v2: true, limit, ...extraFilters };
  const body: Record<string, unknown> = { version: "v2" };
  for (const t of types) body[t] = { ...section };
  const data = await gmgnPost("/v1/trenches", { chain }, body);
  // API selalu balikin near_completion di bawah key `pump`.
  return {
    new_creation: data?.new_creation ?? [],
    near_completion: data?.pump ?? [],
    completed: data?.completed ?? [],
  };
}

/** GET /v1/market/rank — trending token, bisa difilter min_smart_degen_count dkk. */
export async function getTrending(
  chain: string,
  interval: string,
  extra: Record<string, string | number> = {}
): Promise<any[]> {
  const data = await gmgnGet("/v1/market/rank", { chain, interval, ...extra });
  return data?.rank ?? [];
}

/** GET /v1/market/token_top_traders — daftar wallet trader top untuk 1 token. */
export async function getTopTraders(chain: string, address: string, limit = 100): Promise<any[]> {
  const data = await gmgnGet("/v1/market/token_top_traders", { chain, address, limit });
  return data?.list ?? [];
}

/** GET /v1/token/security — status keamanan kontrak (rug, honeypot, dll). */
export async function getTokenSecurity(chain: string, address: string): Promise<any> {
  return gmgnGet("/v1/token/security", { chain, address });
}

/**
 * GET /v1/user/wallet_activity — riwayat transaksi (buy/sell/transfer) satu wallet.
 * Ini endpoint "exist auth" (cuma butuh GMGN_API_KEY, sama seperti fungsi lain di
 * file ini) — BEDA dengan /v1/user/wallet_holdings yang butuh signature
 * GMGN_PRIVATE_KEY (auth "critical"). Sengaja pakai activity, bukan holdings,
 * biar tidak perlu setup keypair Ed25519 tambahan.
 *
 * CATATAN: nama field persis dari respons mentah endpoint ini belum
 * terverifikasi 100% (GMGN tidak publikasikan dokumentasi resmi terbuka untuk
 * openapi.gmgn.ai). Kalau array yang di-return selalu kosong padahal wallet-nya
 * aktif, cek dulu isi `data` mentahnya (misal lewat console.log sementara di
 * /api/wallet-watch/scan) lalu sesuaikan key di sini dan di normalizeActivity
 * (lib/wallet-watch/tracker.ts).
 */
export async function getWalletActivity(chain: string, wallet: string, limit = 20): Promise<any[]> {
  const data = await gmgnGet("/v1/user/wallet_activity", { chain, wallet, limit });
  return data?.list ?? data?.activities ?? data?.history ?? [];
}
