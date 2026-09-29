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

type WalletSignal = {
  tokenAddress: string;
  tokenSymbol: string;
  wallets: string[];
  sources: string[];
};

type ScanResponse = {
  sightings: TokenSighting[];
  signals: WalletSignal[];
  sourceStatus?: SourceStatus[];
  error?: string;
};

const CHAINS = [
  { value: "sol", label: "Solana" },
  { value: "bsc", label: "BSC" },
  { value: "base", label: "Base" },
  { value: "eth", label: "Ethereum" },
];

const POLL_MS = 20_000;

function short(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

export default function WalletWatchPanel() {
  const [chain, setChain] = useState("sol");
  const [tokenInput, setTokenInput] = useState("");

  const [wallets, setWallets] = useState<WalletCandidate[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const [watching, setWatching] = useState(false);
  const [feed, setFeed] = useState<TokenSighting[]>([]);
  const [signals, setSignals] = useState<WalletSignal[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const [discoverSourceStatus, setDiscoverSourceStatus] = useState<SourceStatus[]>([]);
  const [keyUsage, setKeyUsage] = useState<{ gmgn?: KeyUsage; etherscan?: KeyUsage }>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const walletsRef = useRef<string[]>([]);

  const runScan = useCallback(async () => {
    const addrs = walletsRef.current;
    if (addrs.length === 0) return;
    setScanError(null);
    try {
      const params = new URLSearchParams({ chain });
      addrs.forEach((w) => params.append("wallet", w));
      const res = await fetch(`/api/wallet-watch/scan?${params.toString()}`, { cache: "no-store" });
      const json: ScanResponse = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setFeed(json.sightings ?? []);
      setSignals(json.signals ?? []);
      setSourceStatus(json.sourceStatus ?? []);
      setLastScanAt(new Date().toLocaleTimeString("id-ID"));
    } catch (e: any) {
      setScanError(e.message ?? String(e));
    }
  }, [chain]);

  // Cari dompet lalu OTOMATIS langsung mulai pantau semuanya — tidak ada
  // langkah pilih manual. Semua dompet yang ketemu (maks 20) dipantau.
  const findAndWatch = useCallback(async () => {
    if (!tokenInput.trim()) return;
    setLoadingWallets(true);
    setDiscoverError(null);
    setWallets([]);
    setWatching(false);
    setFeed([]);
    setSignals([]);
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
      const found: WalletCandidate[] = json.wallets ?? [];
      setWallets(found);
      setDiscoverSourceStatus(json.sourceStatus ?? []);
      setKeyUsage({ gmgn: json.gmgnUsage, etherscan: json.etherscanUsage });
      walletsRef.current = found.map((w) => w.address);
      if (found.length > 0) {
        setWatching(true);
        await runScan();
      }
    } catch (e: any) {
      setDiscoverError(e.message ?? String(e));
    } finally {
      setLoadingWallets(false);
    }
  }, [chain, tokenInput, runScan]);

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

  const signalTokens = new Set(signals.map((s) => s.tokenAddress));

  return (
    <div className="memecoin-panel">
      <InfoBox
        chips={[
          "🔗 1 token → auto 20 wallet",
          "⏱️ Polling ±20 detik",
          "🚨 Sinyal: ≥3 dompet beli sama",
        ]}
      >
        Masukin 1 <b>contract address token</b>, klik cari — sisanya otomatis: sistem cari sampai 20 dompet
        yang pegang/beli koin itu (gabungan <b>GMGN</b> + <b>Helius</b> untuk Solana, atau <b>GMGN</b> +{" "}
        <b>Etherscan</b> untuk chain EVM), lalu langsung mantau aktivitas beli SEMUA dompet itu tiap ±20 detik
        — tidak perlu pilih dompet manual. Kalau ada 1 token yang sama-sama dibeli di ≥3 dompet berbeda, itu
        ditandai sebagai <b>sinyal</b>.
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
          placeholder="Contract address token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          disabled={watching || loadingWallets}
        />
        <button className="refresh" onClick={findAndWatch} disabled={loadingWallets || watching || !tokenInput.trim()}>
          {loadingWallets ? "Mencari…" : "Cari & pantau otomatis"}
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

      {wallets.length > 0 && (
        <div className="tag-note" style={{ marginBottom: 12 }}>
          Memantau {wallets.length} dompet
          {lastScanAt ? ` · update terakhir ${lastScanAt}` : ""} — sumber:{" "}
          {[...new Set(wallets.flatMap((w) => w.sources))].join(", ")}
        </div>
      )}

      {scanError && <div className="error-box">{scanError}</div>}

      {sourceStatus.length > 0 && (
        <>
          <div className="tag-note" style={{ marginBottom: 2 }}>
            Status sumber data aktivitas beli (kalau semua "gagal", itu sebabnya belum ada sinyal):
          </div>
          <SourceStatusLine statuses={sourceStatus} />
        </>
      )}

      {signals.length > 0 && (
        <div className="coin-card match" style={{ marginBottom: 14 }}>
          <div className="coin-card-top">
            <span className="symbol">🔔 Sinyal aktif</span>
          </div>
          {signals.map((s) => (
            <div key={s.tokenAddress} className="tag-note" style={{ marginTop: 4 }}>
              <b>{s.tokenSymbol}</b> muncul di {s.wallets.length} dompet berbeda ({s.wallets.map(short).join(", ")}) ·
              via {s.sources.join(" + ")}
            </div>
          ))}
        </div>
      )}

      {watching && (
        <>
          <div className="tag-note" style={{ marginBottom: 8 }}>
            Live feed (transaksi beli terbaru dari semua dompet yang dipantau)
          </div>
          {feed.length === 0 && <div className="empty-state">Belum ada aktivitas beli terbaru.</div>}
          {feed.slice(0, 40).map((s, i) => (
            <div
              key={`${s.wallet}-${s.tokenAddress}-${s.timestamp}-${i}`}
              className={`coin-card ${signalTokens.has(s.tokenAddress) ? "match" : ""}`}
              style={{ padding: "10px 14px", marginBottom: 6 }}
            >
              <div className="coin-card-top" style={{ marginBottom: 0 }}>
                <span className="symbol mono" style={{ fontSize: 13 }}>
                  {short(s.wallet)}
                </span>
                <span className="price">
                  <b>{s.tokenSymbol}</b>
                  {signalTokens.has(s.tokenAddress) && (
                    <span style={{ color: "var(--buy)", marginLeft: 6 }}>· sinyal</span>
                  )}
                  <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: 11 }}>({s.source})</span>
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
