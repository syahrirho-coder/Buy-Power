// Rotasi otomatis banyak Twelve Data API key (free/Basic: 8 credit/menit, 800 credit/hari per key).
//
// Env:
//   TWELVEDATA_API_KEYS=key1,key2,...,key10   (dipisah koma / spasi / baris baru)
//   TWELVEDATA_API_KEY=key                    (1 key saja, tetap didukung, digabung ke pool)
//   TWELVEDATA_CREDITS_PER_MIN=8              (opsional, default 8 = limit free tier)
//   TWELVEDATA_DAILY_CREDITS_PER_KEY=780      (opsional, batas lunak harian, default 780 dari 800)
//
// Cara kerja:
// - Tiap request (1 simbol x 1 timeframe = 1 credit) pilih key dengan pemakaian
//   hari ini PALING SEDIKIT yang masih punya jatah credit di menit ini.
// - Jatah per menit dihitung sliding-window 60 detik per key. Kalau semua key
//   penuh, request menunggu sampai ada slot kosong (selama masih dalam deadline).
// - 429 "per menit" -> key dianggap penuh sampai menit berikut; 429 "harian" ->
//   key istirahat sampai 00:00 UTC; 401/403 (key salah) -> cooldown 1 jam.
//   Request otomatis diulang ke key lain.
//
// CATATAN: counter disimpan di memori proses (best-effort). Di serverless tiap
// instance punya counter sendiri dan reset saat cold start.

const PER_MIN = Number(process.env.TWELVEDATA_CREDITS_PER_MIN) || 8;
const DAILY_BUDGET = Number(process.env.TWELVEDATA_DAILY_CREDITS_PER_KEY) || 780;

export class TwelveDataError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type KeyState = {
  key: string;
  label: string;
  day: string;
  usedToday: number;
  stamps: number[]; // timestamp credit yang dipakai dalam 60 detik terakhir
  cooldownUntil: number;
  fails: number;
};

let pool: KeyState[] | null = null;

const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadPool(): KeyState[] {
  if (pool) return pool;
  const raw = `${process.env.TWELVEDATA_API_KEYS ?? ""},${process.env.TWELVEDATA_API_KEY ?? ""}`;
  const keys = [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  pool = keys.map((key, i) => ({
    key,
    label: `#${i + 1} …${key.slice(-4)}`,
    day: today(),
    usedToday: 0,
    stamps: [],
    cooldownUntil: 0,
    fails: 0,
  }));
  return pool;
}

function refresh(st: KeyState, now: number) {
  const d = today();
  if (st.day !== d) {
    st.day = d;
    st.usedToday = 0;
  }
  st.stamps = st.stamps.filter((t) => now - t < 60_000);
}

export function twelveDataKeyCount(): number {
  return loadPool().length;
}

/**
 * Reservasi 1 credit di key terbaik. Kalau semua key penuh di menit ini,
 * tunggu slot kosong — tapi tidak melewati `deadline` (epoch ms).
 */
async function reserve(exclude: Set<string>, deadline: number): Promise<KeyState> {
  const all = loadPool();
  if (all.length === 0) {
    throw new TwelveDataError(
      0,
      "TWELVEDATA_API_KEYS belum di-set di env (isi 1-10 key dipisah koma, daftar gratis di twelvedata.com)"
    );
  }
  for (;;) {
    const now = Date.now();
    all.forEach((s) => refresh(s, now));
    const usable = all.filter((s) => !exclude.has(s.key) && s.cooldownUntil <= now && s.usedToday < DAILY_BUDGET);

    if (usable.length === 0) {
      const anyDaily = all.some((s) => s.usedToday >= DAILY_BUDGET);
      throw new TwelveDataError(
        429,
        anyDaily
          ? `Budget harian Twelve Data habis di semua key (${DAILY_BUDGET} credit/key/hari)`
          : "Semua key Twelve Data sedang cooldown/bermasalah"
      );
    }

    const open = usable.filter((s) => s.stamps.length < PER_MIN);
    if (open.length > 0) {
      open.sort((a, b) => a.usedToday + Math.random() * 0.5 - (b.usedToday + Math.random() * 0.5));
      const st = open[0];
      st.stamps.push(now); // dipesan sinkron -> aman untuk request paralel
      st.usedToday += 1;
      return st;
    }

    // Semua key penuh di menit ini -> tunggu slot tertua habis.
    const nextFree = Math.min(...usable.map((s) => s.stamps[0] + 60_000));
    const wait = Math.max(50, nextFree - now + 20);
    if (now + wait > deadline) {
      throw new TwelveDataError(429, "Rate limit Twelve Data per menit (semua key penuh), coba refresh sebentar lagi");
    }
    await sleep(wait);
  }
}

function markBad(st: KeyState, code: number, message: string) {
  st.fails += 1;
  const m = message.toLowerCase();
  if (code === 401 || code === 403) {
    st.cooldownUntil = Date.now() + 60 * 60_000;
  } else if (code === 429 && (m.includes("day") || m.includes("daily"))) {
    const d = new Date();
    st.cooldownUntil = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    st.usedToday = DAILY_BUDGET;
  } else if (code === 429) {
    // limit per menit: penuhi window sampai stamp tertua habis
    const now = Date.now();
    while (st.stamps.length < PER_MIN) st.stamps.push(now);
  } else {
    st.cooldownUntil = Date.now() + Math.min(10_000 * 3 ** (st.fails - 1), 10 * 60_000);
  }
}

const RETRYABLE = (c: number) => c === 429 || c === 401 || c === 403 || c >= 500;

/** Jalankan `fn(key)` dengan key terpilih; kalau key bermasalah otomatis coba key lain. */
export async function withTwelveDataKey<T>(
  deadline: number,
  fn: (key: string) => Promise<T>
): Promise<T> {
  const tried = new Set<string>();
  const total = Math.max(loadPool().length, 1);
  let lastErr: unknown;

  for (let attempt = 0; attempt < total; attempt++) {
    let st: KeyState;
    try {
      st = await reserve(tried, deadline);
    } catch (e) {
      throw lastErr ?? e;
    }
    tried.add(st.key);
    try {
      const out = await fn(st.key);
      st.fails = 0;
      return out;
    } catch (e) {
      if (e instanceof TwelveDataError && RETRYABLE(e.code)) {
        markBad(st, e.code, e.message);
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new TwelveDataError(429, "Semua key Twelve Data gagal");
}

export function getTwelveDataUsage() {
  const all = loadPool();
  const now = Date.now();
  all.forEach((s) => refresh(s, now));
  return {
    keys: all.length,
    perMinPerKey: PER_MIN,
    dailyBudgetPerKey: DAILY_BUDGET,
    totalUsedToday: all.reduce((a, s) => a + s.usedToday, 0),
    perKey: all.map((s) => ({
      key: s.label,
      usedToday: s.usedToday,
      cooldownSec: Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000)),
    })),
  };
}
