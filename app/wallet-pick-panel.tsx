"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InfoBox } from "./info-box";
import { KeyUsageLine, SourceStatusLine, type KeyUsage, type SourceStatus } from "./token-links";

type WalletCandidate = {
  address: string;
  rank: number;
  buyVolumeUsd: number;
  sources: string[];
};

type TokenSighting = {
  wallet: string;
  tokenAddress: string;
  tokenSymbol: string;
  side: "buy" | "sell";
  timestamp: number;
  source: string;
};

type ScanResponse = {
  sightings: TokenSighting[];
  sourceStatus?: SourceStatus[];
  error?: string;
};

type TokenTally = {
  tokenAddress: string;
  tokenSymbol: string;
  wallets: string[];
};

const CHAINS = [
  { value: "sol", label: "Solana" },
  { value: "bsc", label: "BSC" },
  { value: "base", label: "Base" },
  { value: "eth", label: "Ethereum" },
];

const POLL_MS = 20_000;
const MIN_PICK = 3; // minimal 3 dompet dipilih — boleh lebih, ga ada batas atas selain hasil discover (maks 20)
const SIGNAL_THRESHOLD = 3; // 1 koin dianggap sinyal begitu muncul di >= 3 dompet manapun yang dipantau

function short(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}jt`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}rb`;
  return `$${n.toFixed(0)}`;
}

function tierLabel(count: number): { text: string; cls: string } {
  if (count >= SIGNAL_THRESHOLD) return { text: `🔔 SINYAL — muncul di ${count} dompet berbeda`, cls: "match" };
  if (count === 2) return { text: "👀 Perlu diperhatikan — muncul di 2 dompet", cls: "" };
  return { text: "🍀 Mungkin cuma keberuntungan — cuma 1 dompet", cls: "" };
}

export default function WalletPickPanel() {
  const [chain, setChain] = useState("sol");
  const [tokenInput, setTokenInput] = useState("");

  const [wallets, setWallets] = useState<WalletCandidate[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverSourceStatus, setDiscoverSourceStatus] = useState<SourceStatus[]>([]);
  const [keyUsage, setKeyUsage] = useState<{ gmgn?: KeyUsage; etherscan?: KeyUsage }>({});

  const [picked, setPicked] = useState<string[]>([]);
  const [watching, setWatching] = useState(false);
  const [feed, setFeed] = useState<TokenSighting[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pickedRef = useRef<string[]>([]);

  const feedBoxRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pauseScroll, setPauseScroll] = useState(false);

  const findWallets = useCallback(async () => {
    if (!tokenInput.trim()) return;
    setLoadingWallets(true);
    setDiscoverError(null);
    setWallets([]);
    setPicked([]);
    pickedRef.current = [];
    setWatching(false);
    setFeed([]);
    setSourceStatus([]);
    setDiscoverSourceStatus([]);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const res = await fetch(
        `/api/wallet-watch/discover?chain=${chain}&address=${encodeURIComponent(tokenInput.trim())}&limit=20`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setWallets(json.wallets ?? []);
      setDiscoverSourceStatus(json.sourceStatus ?? []);
      setKeyUsage({ gmgn: json.gmgnUsage, etherscan: json.etherscanUsage });
    } catch (e: any) {
      setDiscoverError(e.message ?? String(e));
    } finally {
      setLoadingWallets(false);
    }
  }, [chain, tokenInput]);

  const togglePick = (address: string) => {
    setPicked((prev) => {
      if (prev.includes(address)) return prev.filter((a) => a !== address);
      if (prev.length >= 20) return prev; // batas atas cuma ikutan batas hasil discover/scan API
      return [...prev, address];
    });
  };

  const runScan = useCallback(async () => {
    const addrs = pickedRef.current;
    if (addrs.length === 0) return;
    setScanError(null);
    try {
      const params = new URLSearchParams({ chain, minWalletsForSignal: String(SIGNAL_THRESHOLD) });
      addrs.forEach((w) => params.append("wallet", w));
      const res = await fetch(`/api/wallet-watch/scan?${params.toString()}`, { cache: "no-store" });
      const json: ScanResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFeed(json.sightings ?? []);
      setSourceStatus(json.sourceStatus ?? []);
      setLastScanAt(new Date().toLocaleTimeString("id-ID"));
    } catch (e: any) {
      setScanError(e.message ?? String(e));
    }
  }, [chain]);

  const startWatching = useCallback(async () => {
    pickedRef.current = picked;
    setWatching(true);
    await runScan();
  }, [picked, runScan]);

  useEffect(() => {
    if (!watching) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(runScan, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [watching, runScan]);

  // Auto-scroll: list feed jalan otomatis ke bawah, loop lagi ke atas.
  // Berhenti sebentar kalau kursor sedang di atas listnya.
  useEffect(() => {
    if (!watching || feed.length === 0) {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current);
      return;
    }
    autoScrollRef.current = setInterval(() => {
      const box = feedBoxRef.current;
      if (!box || pauseScroll) return;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) {
        box.scrollTop = 0;
      } else {
        box.scrollTop += 1;
      }
    }, 60);
    return () => {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    };
  }, [watching, feed, pauseScroll]);

  // Tally token yang muncul berulang di dompet-dompet terpilih.
  const tally = new Map<string, TokenTally>();
  for (const s of feed) {
    const t = tally.get(s.tokenAddress) ?? { tokenAddress: s.tokenAddress, tokenSymbol: s.tokenSymbol, wallets: [] };
    if (!t.wallets.includes(s.wallet)) t.wallets.push(s.wallet);
    tally.set(s.tokenAddress, t);
  }
  const tallyList = [...tally.values()].sort((a, b) => b.wallets.length - a.wallets.length);

  return (
    <div className="memecoin-panel">
      <InfoBox
        chips={[
          "🎯 Pilih 3+ dompet manual",
          "🆓 100% sumber gratis",
          "🚨 Sinyal: ≥3 dompet, koin sama",
        ]}
      >
        Alurnya manual, sekali coba per hari juga cukup: pilih <b>1 koin</b>, sistem cari sampai{" "}
        <b>20 dompet</b> pemegang/pembeli koin itu (gabungan GMGN + Helius/Etherscan —
        tidak butuh API key berbayar). Dari 20 itu, kamu pilih sendiri minimal <b>3 dompet</b> buat dipantau —
        lebih dari 3 juga boleh. Kalau 1 koin cuma muncul di 1 dompet, itu bisa jadi cuma kebetulan. Tapi kalau
        koin yang sama muncul di <b>3 dompet berbeda atau lebih</b>, itu ditandai sebagai sinyal. Feed di bawah
        jalan sendiri (auto-scroll).
      </InfoBox>

      <div className="controls">
        <select value={chain} onChange={(e) => setChain(e.target.value)} disabled={watching || loadingWallets}>
          {CHAINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Contract address token (1 koin)"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          disabled={watching || loadingWallets}
        />
        <button className="refresh" onClick={findWallets} disabled={loadingWallets || watching || !tokenInput.trim()}>
          {loadingWallets ? "Mencari…" : "1. Cari 20 dompet"}
        </button>
        {watching && (
          <button
            className="link-btn"
            onClick={() => {
              setWatching(false);
            }}
          >
            Stop
          </button>
        )}
      </div>

      {discoverError && <div className="error-box">{discoverError}</div>}

      {discoverSourceStatus.length > 0 && <SourceStatusLine statuses={discoverSourceStatus} />}
      <KeyUsageLine
        items={[
          { name: "GMGN", usage: keyUsage.gmgn },
          { name: "Etherscan", usage: keyUsage.etherscan },
        ]}
      />

      {wallets.length > 0 && !watching && (
        <>
          <div className="tag-note" style={{ marginBottom: 10 }}>
            Ketemu {wallets.length} dompet. Pilih minimal <b>{MIN_PICK}</b> buat dipantau — lebih dari itu boleh
            ({picked.length} terpilih{picked.length < MIN_PICK ? `, minimal ${MIN_PICK}` : ""}).
          </div>
          {wallets.map((w) => {
            const isPicked = picked.includes(w.address);
            return (
              <div
                key={w.address}
                className={`coin-card ${isPicked ? "match" : ""}`}
                style={{ padding: "10px 14px", marginBottom: 6, cursor: "pointer" }}
                onClick={() => togglePick(w.address)}
              >
                <div className="coin-card-top" style={{ marginBottom: 0 }}>
                  <span className="symbol" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={isPicked} readOnly />
                    <span className="mono" style={{ fontSize: 13 }}>
                      #{w.rank} {short(w.address)}
                    </span>
                  </span>
                  <span className="price">
                    {fmtUsd(w.buyVolumeUsd)} · {w.sources.join("+")}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="controls" style={{ marginTop: 12 }}>
            <button className="refresh" onClick={startWatching} disabled={picked.length < MIN_PICK}>
              2. Pantau {picked.length || ""} dompet terpilih
            </button>
          </div>
        </>
      )}

      {scanError && <div className="error-box">{scanError}</div>}

      {watching && sourceStatus.length > 0 && (
        <>
          <div className="tag-note" style={{ marginBottom: 2 }}>
            Status sumber data aktivitas beli (kalau semua "gagal", itu sebabnya belum ada sinyal):
          </div>
          <SourceStatusLine statuses={sourceStatus} />
        </>
      )}

      {watching && (
        <>
          <div className="tag-note" style={{ marginBottom: 12 }}>
            Memantau {pickedRef.current.length} dompet: {pickedRef.current.map(short).join(", ")}
            {lastScanAt ? ` · update terakhir ${lastScanAt}` : ""}
          </div>

          <div className="tag-note" style={{ marginBottom: 8 }}>
            Nama proyek yang muncul berulang di dompet-dompet ini
          </div>
          {tallyList.length === 0 && <div className="empty-state">Belum ada aktivitas beli terbaru.</div>}
          {tallyList.map((t) => {
            const tier = tierLabel(t.wallets.length);
            return (
              <div key={t.tokenAddress} className={`coin-card ${tier.cls}`} style={{ marginBottom: 8 }}>
                <div className="coin-card-top">
                  <span className="symbol">{t.tokenSymbol}</span>
                  <span className="price">{t.wallets.length}/{pickedRef.current.length} dompet</span>
                </div>
                <div className="tag-note" style={{ marginTop: 0 }}>{tier.text}</div>
              </div>
            );
          })}

          <div className="tag-note" style={{ marginTop: 18, marginBottom: 8 }}>
            Live feed (auto-scroll — arahkan kursor ke sini buat pause)
          </div>
          <div
            ref={feedBoxRef}
            onMouseEnter={() => setPauseScroll(true)}
            onMouseLeave={() => setPauseScroll(false)}
            style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}
          >
            {feed.length === 0 && <div className="empty-state">Belum ada aktivitas beli terbaru.</div>}
            {feed.map((s, i) => {
              const isRepeat = (tally.get(s.tokenAddress)?.wallets.length ?? 0) >= SIGNAL_THRESHOLD;
              return (
                <div
                  key={`${s.wallet}-${s.tokenAddress}-${s.timestamp}-${i}`}
                  className={`coin-card ${isRepeat ? "match" : ""}`}
                  style={{ padding: "10px 14px", marginBottom: 6 }}
                >
                  <div className="coin-card-top" style={{ marginBottom: 0 }}>
                    <span className="symbol mono" style={{ fontSize: 13 }}>
                      {short(s.wallet)}
                    </span>
                    <span className="price">
                      <b>{s.tokenSymbol}</b>
                      <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: 11 }}>({s.source})</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
