// Pool rotasi API key generik (dipakai GMGN & Etherscan, maks 5 key per provider).
//
// Cara kerja (sama seperti helius-keys.ts / twelvedata-keys.ts):
// - Tiap request pilih key dengan pemakaian hari ini PALING SEDIKIT (bukan
//   round-robin buta), sedikit acak biar seri tidak selalu jatuh ke key #1.
// - Tiap key di-throttle sendiri-sendiri (jeda minimum antar request) sesuai
//   limit per-detik provider, jadi 5 key = throughput sekitar 5x lipat.
// - Kalau key kena limit / key salah / 5xx, key itu masuk cooldown (naik
//   bertahap sampai 1 jam) dan request otomatis diulang ke key lain.
//
// CATATAN: counter disimpan di memori proses (best-effort). Di serverless tiap
// instance punya counter sendiri dan reset saat cold start.

export class KeyPoolError extends Error {
  /** true = masalah di KEY-nya (limit/invalid) -> coba key lain. false = error biasa, lempar langsung. */
  rotate: boolean;
  /** cooldown yang disarankan untuk key ini (ms); kosong = pakai backoff bawaan. */
  cooldownMs?: number;
  constructor(message: string, opts: { rotate?: boolean; cooldownMs?: number } = {}) {
    super(message);
    this.rotate = opts.rotate ?? false;
    this.cooldownMs = opts.cooldownMs;
  }
}

type KeyState = {
  key: string;
  label: string;
  day: string;
  usedToday: number;
  cooldownUntil: number;
  fails: number;
  nextAt: number;
};

export type KeyPoolOptions = {
  name: string;
  /** Nama env berisi banyak key dipisah koma/spasi/baris baru, mis. GMGN_API_KEYS. */
  listEnv: string;
  /** Nama env lama berisi 1 key, mis. GMGN_API_KEY (tetap didukung, digabung ke pool). */
  singleEnv: string;
  maxKeys?: number;
  /** Jeda minimum antar request PER KEY (ms). */
  minGapMs: number;
  /** Batas lunak request per key per hari; 0 = tanpa batas. */
  dailyBudget?: number;
  signupHint: string;
};

export function createKeyPool(opts: KeyPoolOptions) {
  const maxKeys = opts.maxKeys ?? 5;
  const budget = opts.dailyBudget ?? 0;
  let pool: KeyState[] | null = null;

  const today = () => new Date().toISOString().slice(0, 10);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function load(): KeyState[] {
    if (pool) return pool;
    const raw = `${process.env[opts.listEnv] ?? ""},${process.env[opts.singleEnv] ?? ""}`;
    const keys = [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))].slice(0, maxKeys);
    pool = keys.map((key, i) => ({
      key,
      label: `#${i + 1} …${key.slice(-4)}`,
      day: today(),
      usedToday: 0,
      cooldownUntil: 0,
      fails: 0,
      nextAt: 0,
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
    const all = load();
    if (all.length === 0) {
      throw new KeyPoolError(
        `${opts.listEnv} belum di-set di env (isi 1-${maxKeys} key dipisah koma). ${opts.signupHint}`
      );
    }
    const now = Date.now();
    all.forEach(rollDay);
    const free = all.filter((s) => !exclude.has(s.key));
    const ready = free.filter((s) => s.cooldownUntil <= now);
    const usable = budget > 0 ? ready.filter((s) => s.usedToday < budget) : ready;

    if (usable.length === 0) {
      if (ready.length > 0) {
        throw new KeyPoolError(
          `Budget harian ${opts.name} habis di semua key (${budget} request/key/hari). Naikkan batasnya di env atau tunggu besok (UTC).`
        );
      }
      if (free.length > 0) {
        const wait = Math.ceil((Math.min(...free.map((s) => s.cooldownUntil)) - now) / 1000);
        throw new KeyPoolError(`Semua key ${opts.name} sedang cooldown (coba lagi ~${wait} detik)`);
      }
      throw new KeyPoolError(`Semua key ${opts.name} gagal untuk request ini`);
    }
    const score = new Map(usable.map((s) => [s, s.usedToday + Math.random() * 0.5]));
    usable.sort((a, b) => score.get(a)! - score.get(b)!);
    return usable[0];
  }

  async function throttle(st: KeyState) {
    const now = Date.now();
    const at = Math.max(now, st.nextAt);
    st.nextAt = at + opts.minGapMs; // slot dipesan sinkron -> aman untuk request paralel
    if (at > now) await sleep(at - now);
  }

  function markBad(st: KeyState, cooldownMs?: number) {
    st.fails += 1;
    st.cooldownUntil = Date.now() + (cooldownMs ?? Math.min(10_000 * 3 ** (st.fails - 1), 60 * 60_000));
  }

  /** Jalankan `fn(key)`; kalau melempar KeyPoolError{rotate:true}, key di-cooldown & coba key lain. */
  async function withKey<T>(fn: (key: string) => Promise<T>): Promise<T> {
    const tried = new Set<string>();
    const total = Math.max(load().length, 1);
    let lastErr: unknown;
    for (let attempt = 0; attempt < total; attempt++) {
      let st: KeyState;
      try {
        st = pick(tried);
      } catch (e) {
        throw lastErr ?? e;
      }
      tried.add(st.key);
      st.usedToday += 1; // dihitung SINKRON sebelum await -> request paralel tetap menyebar merata
      await throttle(st);
      try {
        const out = await fn(st.key);
        st.fails = 0;
        return out;
      } catch (e) {
        if (e instanceof KeyPoolError && e.rotate) {
          markBad(st, e.cooldownMs);
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw lastErr ?? new KeyPoolError(`Semua key ${opts.name} gagal`);
  }

  function usage() {
    const all = load();
    all.forEach(rollDay);
    const now = Date.now();
    return {
      keys: all.length,
      totalUsedToday: all.reduce((a, s) => a + s.usedToday, 0),
      perKey: all.map((s) => ({
        key: s.label,
        usedToday: s.usedToday,
        cooldownSec: Math.max(0, Math.ceil((s.cooldownUntil - now) / 1000)),
      })),
    };
  }

  return { withKey, usage, keyCount: () => load().length };
}
