// Rotasi otomatis banyak Helius API key (tier gratis: 1M credit / 30 hari / key).
//
// Env:
//   HELIUS_API_KEYS=key1,key2,key3,key4,key5   (dipisah koma / spasi / baris baru)
//   HELIUS_API_KEY=key                         (lama, tetap didukung, digabung ke pool)
//   HELIUS_DAILY_CREDITS_PER_KEY=30000         (opsional, batas lunak harian per key)
//
// Cara kerja:
// - Tiap request pilih key dengan pemakaian hari ini PALING SEDIKIT (bukan
//   round-robin buta) -> beban 5 key selalu seimbang.
// - Kalau key kena 429 / 401 / 403 / 5xx, key itu masuk cooldown (naik
//   bertahap sampai 1 jam) dan request otomatis diulang ke key lain.
// - Tiap key di-throttle sendiri-sendiri sesuai limit gratis Helius
//   (RPC 10 req/s, DAS 2 req/s) supaya tidak gampang kena 429.
// - Batas harian per key = budget LUNAK: kalau semua key sudah lewat budget,
//   request ditolak dengan pesan jelas (bukan diam-diam menghabiskan kuota bulanan).
//
// CATATAN: counter disimpan di memori proses. Di serverless (Vercel/Netlify)
// tiap instance punya counter sendiri dan reset saat cold start, jadi ini
// pengaman best-effort, bukan meter resmi. Angka resmi tetap di dashboard.helius.dev.

export type HeliusKind = "rpc" | "das";

// Biaya credit resmi Helius: RPC standar 1, DAS 10.
const CREDIT_COST: Record<HeliusKind, number> = { rpc: 1, das: 10 };
// Jeda minimum antar request per key (free tier: 10 RPC/s, 2 DAS/s), dikasih sedikit margin.
const MIN_GAP_MS: Record<HeliusKind, number> = { rpc: 110, das: 520 };

const DAILY_BUDGET = Number(process.env.HELIUS_DAILY_CREDITS_PER_KEY) || 30_000;

export class HeliusHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type KeyState = {
  key: string;
  label: string;
  day: string;
  usedToday: number;
  cooldownUntil: number;
  fails: number;
  nextAt: Record<HeliusKind, number>;
};

let pool: KeyState[] | null = null;

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadPool(): KeyState[] {
  if (pool) return pool;
  const raw = `${process.env.HELIUS_API_KEYS ?? ""},${process.env.HELIUS_API_KEY ?? ""}`;
  const keys = [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
  pool = keys.map((key, i) => ({
    key,
    label: `#${i + 1} …${key.slice(-4)}`,
    day: today(),
    usedToday: 0,
    cooldownUntil: 0,
    fails: 0,
    nextAt: { rpc: 0, das: 0 },
  }));
  return pool;
}

function rollDay(st: KeyState) {
  const d = today();
  if (st.day !== d) {
    st.day = d;
    st.usedToday = 0;
  }
}

function pick(exclude: Set<string>): KeyState {
  const all = loadPool();
  if (all.length === 0) {
    throw new HeliusHttpError(
      0,
      "HELIUS_API_KEYS belum di-set di env (isi 1-5 key dipisah koma, daftar gratis di dashboard.helius.dev)"
    );
  }
  const now = Date.now();
  all.forEach(rollDay);
  const free = all.filter((s) => !exclude.has(s.key));
  const ready = free.filter((s) => s.cooldownUntil <= now);
  const withBudget = ready.filter((s) => s.usedToday < DAILY_BUDGET);

  if (withBudget.length === 0) {
    if (ready.length > 0) {
      throw new HeliusHttpError(
        429,
        `Budget harian Helius habis di semua key (${DAILY_BUDGET} credit/key/hari). Naikkan HELIUS_DAILY_CREDITS_PER_KEY atau tunggu besok (UTC).`
      );
    }
    if (free.length > 0) {
      const wait = Math.ceil((Math.min(...free.map((s) => s.cooldownUntil)) - now) / 1000);
      throw new HeliusHttpError(429, `Semua key Helius sedang cooldown (coba lagi ~${wait} detik)`);
    }
    throw new HeliusHttpError(429, "Semua key Helius gagal untuk request ini");
  }
  // Paling sedikit dipakai dulu; sedikit acak biar seri tidak selalu key #1.
  const score = new Map(withBudget.map((s) => [s, s.usedToday + Math.random() * 0.5]));
  withBudget.sort((a, b) => score.get(a)! - score.get(b)!);
  return withBudget[0];
}

async function throttle(st: KeyState, kind: HeliusKind) {
  const now = Date.now();
  const at = Math.max(now, st.nextAt[kind]);
  st.nextAt[kind] = at + MIN_GAP_MS[kind]; // slot dipesan sinkron -> aman untuk request paralel
  if (at > now) await sleep(at - now);
}

function markBad(st: KeyState, status: number) {
  st.fails += 1;
  const ms =
    status === 401 || status === 403
      ? 60 * 60_000 // key salah/diblokir
      : Math.min(10_000 * 3 ** (st.fails - 1), 60 * 60_000); // 10s, 30s, 90s, ... maks 1 jam
  st.cooldownUntil = Date.now() + ms;
}

const RETRYABLE = (s: number) => s === 429 || s === 401 || s === 403 || s >= 500;

/** Jalankan `fn(key)` dengan key terpilih; kalau key bermasalah otomatis coba key lain. */
export async function withHeliusKey<T>(kind: HeliusKind, fn: (key: string) => Promise<T>): Promise<T> {
  const tried = new Set<string>();
  const total = Math.max(loadPool().length, 1);
  let lastErr: unknown;

  for (let attempt = 0; attempt < total; attempt++) {
    let st: KeyState;
    try {
      st = pick(tried);
    } catch (e) {
      throw lastErr ?? e;
    }
    tried.add(st.key);
    await throttle(st, kind);
    st.usedToday += CREDIT_COST[kind];
    try {
      const out = await fn(st.key);
      st.fails = 0;
      return out;
    } catch (e) {
      if (e instanceof HeliusHttpError && RETRYABLE(e.status)) {
        markBad(st, e.status);
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new HeliusHttpError(429, "Semua key Helius gagal");
}

/** Ringkasan pemakaian (best-effort, per instance) — dikirim ke UI/response buat dipantau. */
export function getHeliusUsage() {
  const all = loadPool();
  all.forEach(rollDay);
  const now = Date.now();
  return {
    keys: all.length,
    dailyBudgetPerKey: DAILY_BUDGET,
    totalUsedToday: all.reduce((a, s) => a + s.usedToday, 0),
    perKey: all.map((s) => ({
      key: s.label,
      usedToday: s.usedToday,
      cooldownSec: Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000)),
    })),
  };
}
