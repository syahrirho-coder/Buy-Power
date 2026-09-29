"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InfoBox } from "./info-box";
import { CopyCA, fmtUsd, IconLink, KeyUsageLine, LOGO, pumpFunUrl, type KeyUsage } from "./token-links";

type Candidate = {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  dexscreenerChainId: string;
  launchpadPlatform: string;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  holderCount: number | null;
  smartDegenCount: number;
  renownedCount: number;
  buys24h: number;
  sells24h: number;
  buySellRatio: number | null;
  rugRatio: number | null;
  top10HolderRate: number | null;
  stage: string;
  ageMinutes: number | null;
  fresh: boolean;
  volMcapRatio: number | null;
  dexscreenerUrl: string;
};

type WalletHealth = {
  distinctBuyerWallets: number;
  totalBuyTx: number;
  top10TxSharePct: number;
  top10VolSharePct: number;
  avgTxPerWallet: number;
  verdict: "sehat" | "waspada" | "berisiko";
  reason: string;
};

type MomentumCheck = {
  windowMinutes: number;
  recentBuyerCount: number;
  recentSellerCount: number;
  netInflowUsd: number;
  verdict: "momentum masuk" | "netral" | "momentum keluar";
  reason: string;
};

function fmtAge(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}j`;
  return `${(minutes / 1440).toFixed(1)}h`;
}

// Skor gabungan buat sort "Momentum" — bukan skor ilmiah, cuma cara ranking
// yang mengutamakan token yang masih fresh + volume relatif ramai + ada
// smart money, sesuai lapis 2-3 yang didiskusikan (fresh momentum + wallet
// quality). Bukan prediksi harga, cuma urutan tampilan.
function momentumScore(c: Candidate): number {
  const freshPart = c.fresh ? 2 : 0;
  const volPart = Math.min(c.volMcapRatio ?? 0, 5);
  const smartPart = Math.min(c.smartDegenCount, 5) * 0.4;
  return freshPart + volPart + smartPart;
}

function VerdictBadge({ v }: { v: WalletHealth["verdict"] }) {
  const map = { sehat: "buy", waspada: "neutral", berisiko: "sell" } as const;
  return <span className={`tf-badge ${map[v]}`}>{v}</span>;
}

function MomentumBadge({ v }: { v: MomentumCheck["verdict"] }) {
  const map = { "momentum masuk": "buy", netral: "neutral", "momentum keluar": "sell" } as const;
  return <span className={`tf-badge ${map[v]}`}>{v}</span>;
}

/**
 * Logo asli token: coba field logo dari GMGN dulu, lalu fallback ke CDN
 * gambar token DexScreener (by contract address), baru avatar huruf sebagai
 * upaya terakhir kalau memang tidak ketemu di manapun — bukan avatar duluan.
 */
function TokenLogo({ c }: { c: Candidate }) {
  const [idx, setIdx] = useState(0);
  const srcs = [
    c.logoUrl,
    `https://dd.dexscreener.com/ds-data/tokens/${c.dexscreenerChainId}/${c.address}.png?size=lg`,
  ].filter((s): s is string => !!s);

  if (idx >= srcs.length) {
    return <span className="ds-logo-fallback">{c.symbol.slice(0, 3)}</span>;
  }
  return (
    <span className="ds-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={srcs[idx]} alt="" width={22} height={22} onError={() => setIdx((i) => i + 1)} />
    </span>
  );
}

function CandidateCard({ c }: { c: Candidate }) {
  const [health, setHealth] = useState<WalletHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [momentum, setMomentum] = useState<MomentumCheck | null>(null);
  const [momLoading, setMomLoading] = useState(false);
  const [momErr, setMomErr] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/gmgn/wallet-health?chain=${c.chain}&address=${c.address}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setHealth(json);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [c.chain, c.address]);

  const checkMomentum = useCallback(async () => {
    setMomLoading(true);
    setMomErr(null);
    try {
      const res = await fetch(`/api/gmgn/momentum?chain=${c.chain}&address=${c.address}&window=60`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMomentum(json);
    } catch (e: any) {
      setMomErr(e.message ?? String(e));
    } finally {
      setMomLoading(false);
    }
  }, [c.chain, c.address]);

  return (
    <div className="coin-card">
      <div className="coin-card-top">
        <span className="symbol">
          <TokenLogo c={c} />
          {c.symbol}
          <span className="pill">{c.launchpadPlatform}</span>
          <span className="pill">{c.stage}</span>
          {c.fresh && (
            <span className="pill pump" title="Umur token masih di bawah 6 jam — belum lama listing">
              🆕 {fmtAge(c.ageMinutes)}
            </span>
          )}
        </span>
        <span className="price mono">MCap {fmtUsd(c.marketCap)}</span>
      </div>

      {/* 4 kriteria contoh + 2 sinyal momentum tambahan */}
      <div className="coin-meta">
        <span title="Jumlah wallet smart money (GMGN-tagged) yang pegang token ini">
          🧠 Smart money: <b>{c.smartDegenCount}</b>
        </span>
        <span title="Jumlah wallet KOL/renowned yang pegang token ini">
          ⭐ KOL: <b>{c.renownedCount}</b>
        </span>
        <span title="Rasio transaksi beli vs jual 24 jam">
          📊 Buy/Sell: <b>{c.buySellRatio === null ? "—" : c.buySellRatio === Infinity ? "∞" : c.buySellRatio}</b>{" "}
          ({c.buys24h}/{c.sells24h})
        </span>
        <span title="Top 10 holder dari total supply">
          🔒 Top10: <b>{c.top10HolderRate !== null ? `${(c.top10HolderRate * 100).toFixed(0)}%` : "—"}</b>
        </span>
        <span title="Volume 24 jam dibagi market cap — makin tinggi, makin ramai diperdagangkan relatif terhadap ukurannya">
          🔥 Vol/MCap: <b>{c.volMcapRatio !== null ? `${c.volMcapRatio}x` : "—"}</b>
        </span>
      </div>

      <div className="coin-actions">
        <button className="link-btn" onClick={checkHealth} disabled={loading}>
          {loading ? "Mengecek…" : health ? "Cek ulang wallet independen" : "Cek wallet independen"}
        </button>
        <button className="link-btn" onClick={checkMomentum} disabled={momLoading}>
          {momLoading ? "Mengecek…" : momentum ? "Cek ulang momentum" : "Cek momentum (1 jam)"}
        </button>
        <CopyCA address={c.address} />
        <IconLink href={c.dexscreenerUrl} logo={LOGO.dexscreener} label="Buka di DexScreener" className="dexscreener" />
        {c.chain === "sol" && (
          <IconLink href={pumpFunUrl(c.address)} logo={LOGO.pumpfun} label="Buka di pump.fun" className="pumpfun" />
        )}
      </div>

      {err && <div className="tag-note" style={{ color: "var(--sell)" }}>{err}</div>}
      {momErr && <div className="tag-note" style={{ color: "var(--sell)" }}>{momErr}</div>}

      {health && (
        <div className="readme-box" style={{ marginTop: 10, marginBottom: 0 }}>
          <VerdictBadge v={health.verdict} /> {health.reason}
          <div className="tag-note" style={{ marginTop: 6 }}>
            {health.distinctBuyerWallets} wallet independen · top 10 wallet = {health.top10TxSharePct.toFixed(0)}% transaksi beli,{" "}
            {health.top10VolSharePct.toFixed(0)}% volume beli · rata-rata {health.avgTxPerWallet.toFixed(1)} tx/wallet
          </div>
        </div>
      )}

      {momentum && (
        <div className="readme-box" style={{ marginTop: 8, marginBottom: 0 }}>
          <MomentumBadge v={momentum.verdict} /> {momentum.reason}
          <div className="tag-note" style={{ marginTop: 6 }}>
            Net {momentum.netInflowUsd >= 0 ? "inflow" : "outflow"} ~${Math.abs(momentum.netInflowUsd).toFixed(0)} dari top
            trader dalam {momentum.windowMinutes} menit terakhir.
          </div>
        </div>
      )}
    </div>
  );
}

type SortMode = "smart" | "momentum";

export default function GmgnPanel() {
  const [chain, setChain] = useState("sol");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poolInfo, setPoolInfo] = useState<{ pool: number; passed: number } | null>(null);
  const [keyUsage, setKeyUsage] = useState<KeyUsage | null>(null);
  const [onlyFresh, setOnlyFresh] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("smart");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gmgn/discover?chain=${chain}&limit=30`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setCandidates(json.results ?? []);
      setPoolInfo({ pool: json.candidatePool ?? 0, passed: json.passedScreen ?? 0 });
      setKeyUsage(json.usage ?? null);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [chain]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const base = onlyFresh ? candidates.filter((c) => c.fresh) : candidates;
    const sorted = [...base];
    if (sortMode === "momentum") {
      sorted.sort((a, b) => momentumScore(b) - momentumScore(a));
    } else {
      sorted.sort((a, b) => b.smartDegenCount - a.smartDegenCount);
    }
    return sorted;
  }, [candidates, onlyFresh, sortMode]);

  return (
    <div className="memecoin-panel">
      <InfoBox
        chips={[
          "🧠 Filter smart money + KOL",
          "🛡️ Rug ratio < 0.3 · top10 < 50%",
          "🆕 Fresh + momentum score",
          "🔎 Cek wallet & momentum",
        ]}
      >
        Screening token yang ada <b>smart money</b> dan/atau <b>KOL (renowned)</b> yang pegang, lolos filter
        aman (rug ratio &lt; 0.3, bukan wash trading, top10 holder &lt; 50%, liquidity &gt; $20k) — via{" "}
        <b>GMGN API</b>. Tiap kartu sekarang juga nampilin <b>umur token</b> (badge 🆕 kalau ≤6 jam — proxy
        "belum telat") dan <b>Vol/MCap ratio</b> 🔥 (volume 24h dibagi market cap — makin tinggi, makin ramai
        relatif terhadap ukurannya). Filter <b>"Hanya fresh"</b> dan sort <b>"Momentum"</b> menggabungkan
        kedua sinyal itu dengan jumlah smart money. Klik <b>"Cek wallet independen"</b> untuk sebaran dompet,
        atau <b>"Cek momentum"</b> untuk lihat apakah top trader lagi net-beli atau net-jual dalam 1 jam
        terakhir (nangkep kasus "smart money diam-diam keluar" yang tidak kelihatan dari snapshot holder).
        Semua ini <b>saringan & konteks tambahan</b>, bukan jaminan 100x — selalu DYOR sebelum masuk.
      </InfoBox>

      <div className="controls">
        <select value={chain} onChange={(e) => setChain(e.target.value)}>
          <option value="sol">Solana</option>
          <option value="bsc">BSC</option>
          <option value="base">Base</option>
          <option value="eth">Ethereum</option>
        </select>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
          <option value="smart">Urutkan: Smart money</option>
          <option value="momentum">Urutkan: Momentum (fresh+vol+smart)</option>
        </select>
        <label className="only-matches">
          <input type="checkbox" checked={onlyFresh} onChange={(e) => setOnlyFresh(e.target.checked)} />
          Hanya fresh (≤6 jam)
        </label>
        <button className="refresh" onClick={load} disabled={loading}>
          {loading ? "Memuat…" : "Refresh"}
        </button>
        {poolInfo && (
          <span className="status-line">
            <span className="num">{poolInfo.passed}</span> lolos dari <span className="num">{poolInfo.pool}</span> kandidat
          </span>
        )}
      </div>

      <KeyUsageLine items={[{ name: "GMGN", usage: keyUsage }]} />

      {error && <div className="error-box">{error}</div>}
      {!error && !loading && visible.length === 0 && (
        <div className="empty-state">
          {onlyFresh ? "Tidak ada token fresh (≤6 jam) yang lolos screening saat ini." : "Tidak ada token yang lolos screening saat ini."}
        </div>
      )}

      {visible.map((c) => (
        <CandidateCard key={`${c.chain}:${c.address}`} c={c} />
      ))}
    </div>
  );
}
