"use client";

import { useCallback, useEffect, useState } from "react";
import { InfoBox } from "./info-box";
import { CopyCA, fmtUsd, IconLink, LOGO, pumpFunUrl } from "./token-links";

// 1s/3s/5s DIHAPUS total dari daftar — tidak ada satupun sumber data gratis
// (DexScreener/GeckoTerminal/Bitget/pump.fun, bahkan Binance) yang punya
// candle sekecil itu untuk token on-chain, jadi menampilkannya (walau
// non-klik) cuma bikin bingung. Sisanya ini yang beneran bisa dihitung:
// 1m/5m/15m/1h/4h/1d native GeckoTerminal, sisanya (30m/2h/3d/7d/1w/30d)
// hasil resample di lib/memecoin/timeframes.ts.
const ALL_TFS = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
  "3d",
  "7d",
  "1w",
  "30d",
] as const;

const CHAINS = [
  { value: "", label: "Semua chain" },
  { value: "solana", label: "Solana (pump.fun/Raydium)" },
  { value: "ethereum", label: "Ethereum" },
  { value: "bsc", label: "BSC" },
  { value: "base", label: "Base" },
];

type Token = {
  chainId: string;
  network: string | null;
  dexId: string;
  isPumpFun: boolean;
  pairAddress: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  logoUrl: string | null;
  dexscreenerUrl: string;
  geckoterminalUrl: string | null;
  chart?: { label: string; url: string; isRealTradingView: boolean };
};

type TfAnalysis =
  | { timeframe: string; status: "ok"; price: number; inBuyZone: boolean; inSellZone: boolean }
  | { timeframe: string; status: "insufficient_data" | "unsupported" | "error"; message: string };

function fmtPrice(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function TfChip({
  tf,
  analysis,
  onClick,
}: {
  tf: string;
  analysis?: TfAnalysis;
  onClick: () => void;
}) {
  let cls = "tf-chip";
  let title = "Klik untuk analisa zona di TF ini";
  if (analysis) {
    if (analysis.status === "ok") {
      cls += analysis.inBuyZone ? " buy" : analysis.inSellZone ? " sell" : " neutral";
      title = analysis.inBuyZone ? "buy zone" : analysis.inSellZone ? "sell zone" : "netral";
    } else {
      cls += " error";
      title = analysis.message;
    }
  }
  return (
    <button className={cls} onClick={onClick} title={title}>
      {tf}
    </button>
  );
}

function TokenCard({ token }: { token: Token }) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<Record<string, TfAnalysis>>({});
  const [chart, setChart] = useState(token.chart ?? null);
  const [loadingTf, setLoadingTf] = useState<string | null>(null);
  const [scanningAll, setScanningAll] = useState(false);
  const [onlyBuyZone, setOnlyBuyZone] = useState(true);
  const [logoIdx, setLogoIdx] = useState(0);

  const analyzeTf = useCallback(
    async (tf: string) => {
      if (!token.network) return;
      setLoadingTf(tf);
      try {
        const res = await fetch(
          `/api/memecoin/analyze?network=${token.network}&pool=${token.pairAddress}&tf=${tf}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        const result = json.results?.[0];
        if (result) setAnalysis((prev) => ({ ...prev, [tf]: result }));
        return result as TfAnalysis | undefined;
      } finally {
        setLoadingTf(null);
      }
    },
    [token.network, token.pairAddress]
  );

  const scanAllTfs = useCallback(async () => {
    setScanningAll(true);
    try {
      for (const tf of ALL_TFS) {
        if (analysis[tf]) continue; // sudah pernah dicek
        await analyzeTf(tf);
        // jeda kecil biar tidak nembak GeckoTerminal (30 req/menit) beruntun
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setScanningAll(false);
    }
  }, [analyzeTf, analysis]);

  const loadChart = useCallback(async () => {
    if (chart) return;
    const res = await fetch(
      `/api/memecoin/discover?q=${token.symbol}&withChart=1&limit=1`,
      { cache: "no-store" }
    );
    const json = await res.json();
    const match = json.results?.find((r: Token) => r.pairAddress === token.pairAddress);
    if (match?.chart) setChart(match.chart);
  }, [chart, token.pairAddress, token.symbol]);

  const analyzedCount = Object.keys(analysis).length;
  const buyZoneTfs = ALL_TFS.filter((tf) => {
    const a = analysis[tf];
    return a && a.status === "ok" && a.inBuyZone;
  });
  const hiddenCount = ALL_TFS.filter((tf) => {
    const a = analysis[tf];
    if (!a) return false;
    if (a.status === "ok" && a.inBuyZone) return false;
    return true; // sell / netral / error disembunyikan kalau onlyBuyZone aktif
  }).length;

  const visibleTfs = onlyBuyZone
    ? ALL_TFS.filter((tf) => !analysis[tf] || (analysis[tf].status === "ok" && (analysis[tf] as any).inBuyZone))
    : ALL_TFS;

  const logoSrcs = [
    token.logoUrl,
    `https://dd.dexscreener.com/ds-data/tokens/${token.chainId}/${token.pairAddress}.png?size=lg`,
  ].filter((s): s is string => !!s);

  return (
    <div className="coin-card">
      <div className="coin-card-top">
        <a
          href={token.dexscreenerUrl}
          target="_blank"
          rel="noreferrer"
          title="Buka langsung di DexScreener (sumber data token & harga)"
          className="ds-logo"
        >
          {logoIdx < logoSrcs.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrcs[logoIdx]}
              alt=""
              width={22}
              height={22}
              onError={() => setLogoIdx((i) => i + 1)}
            />
          ) : (
            <span className="ds-logo-fallback">{token.symbol.slice(0, 3)}</span>
          )}
        </a>
        <span className="symbol">
          {token.symbol}
          {token.isPumpFun && <span className="pill pump">pump.fun</span>}
          <span className="pill dex">{token.dexId}</span>
          <span className="pill chain">{token.chainId}</span>
        </span>
        <span className="price mono">{fmtPrice(token.priceUsd)}</span>
      </div>
      <div className="coin-meta">
        <span>Vol 24h: {fmtUsd(token.volume24h)}</span>
        <span>Liq: {fmtUsd(token.liquidityUsd)}</span>
        <span className={(token.priceChange24h ?? 0) >= 0 ? "up" : "down"}>
          {token.priceChange24h?.toFixed(1) ?? "—"}% (24h)
        </span>
      </div>

      <div className="coin-actions">
        <button
          className="link-btn"
          onClick={() => {
            setOpen((o) => !o);
            loadChart();
          }}
        >
          {open ? "Tutup analisa" : "Analisa zona per TF"}
        </button>
        <CopyCA address={token.tokenAddress} />
        <IconLink
          href={token.dexscreenerUrl}
          logo={LOGO.dexscreener}
          label="Buka di DexScreener (sumber data token & harga)"
          className="dexscreener"
        />
        {token.isPumpFun && (
          <IconLink
            href={pumpFunUrl(token.tokenAddress)}
            logo={LOGO.pumpfun}
            label="Buka di pump.fun"
            className="pumpfun"
          />
        )}
        {chart && (
          <IconLink
            href={chart.url}
            logo={chart.isRealTradingView ? LOGO.tradingview : LOGO.geckoterminal}
            label={
              chart.isRealTradingView
                ? "Chart TradingView asli — token ini listing spot di CEX"
                : "Token ini belum listing di exchange manapun yang diindex TradingView, jadi link ke chart GeckoTerminal"
            }
            className={chart.isRealTradingView ? "tradingview" : "geckoterminal"}
          />
        )}
        {!chart && token.geckoterminalUrl && (
          <IconLink
            href={token.geckoterminalUrl}
            logo={LOGO.geckoterminal}
            label="GeckoTerminal — sumber candle on-chain yang dipakai buat hitung zona buy/sell power"
            className="geckoterminal"
          />
        )}
      </div>

      {open && (
        <>
          <div className="coin-actions" style={{ marginTop: 10 }}>
            <button className="link-btn chart" onClick={scanAllTfs} disabled={scanningAll || !token.network}>
              {scanningAll
                ? `Mengecek… (${analyzedCount}/${ALL_TFS.length})`
                : "Cek semua TF sekaligus"}
            </button>
            <label className="only-matches" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={onlyBuyZone}
                onChange={(e) => setOnlyBuyZone(e.target.checked)}
              />
              Hanya tampilkan yang di buy power zone
            </label>
          </div>

          <div className="tf-row wrap-tf">
            {visibleTfs.map((tf) => (
              <TfChip
                key={tf}
                tf={tf}
                analysis={analysis[tf]}
                onClick={() => analyzeTf(tf)}
              />
            ))}
            {loadingTf && <span className="loading-tf">menghitung {loadingTf}…</span>}
          </div>

          {onlyBuyZone && analyzedCount > 0 && (
            <div className="tag-note" style={{ marginTop: 8 }}>
              {buyZoneTfs.length > 0
                ? `${buyZoneTfs.length} TF lagi di buy zone (${hiddenCount} TF lain — sell/netral/error — disembunyikan).`
                : `Belum ada TF yang match buy power zone untuk token ini sekarang (${hiddenCount} TF lain dicek tapi tidak match).`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MemecoinPanel() {
  const [chain, setChain] = useState("solana");
  const [query, setQuery] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (chain) params.set("chain", chain);
      if (query) params.set("q", query);
      const res = await fetch(`/api/memecoin/discover?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setTokens(json.results ?? []);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [chain, query]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="memecoin-panel">
      <InfoBox
        chips={[
          "🔍 Sumber: DexScreener + watchlist",
          "📈 Analisa TF: GeckoTerminal",
          "⏱️ TF 30m–30d hasil resample",
        ]}
      >
        Daftar token diambil dari <b>DexScreener</b> (token yang lagi di-boost
        + profile token baru, ~40-60 unik per refresh — ini feed "lagi
        rame", bukan daftar lengkap semua memecoin) digabung dengan{" "}
        <b>watchlist token lama</b> (BONK, WIF, PEPE, dst — bisa diedit di
        kode) biar token besar yang jarang muncul di feed baru tetap
        kelihatan. Klik <b>logo</b> di tiap kartu buat langsung ke halaman
        DexScreener token itu (sumber data & harga). Klik <b>"Analisa zona
        per TF"</b> lalu <b>"Cek semua TF sekaligus"</b> untuk hitung zona
        buy/sell power di semua timeframe sekaligus pakai candle asli dari{" "}
        <b>GeckoTerminal</b> — dengan filter <b>"Hanya tampilkan yang di
        buy power zone"</b> aktif secara default, TF yang hasilnya sell
        zone/netral/error otomatis disembunyikan, cuma yang match buy zone
        yang kelihatan. TF <b>1s/3s/5s sudah dihapus</b> dari daftar — tidak
        ada satupun sumber gratis (termasuk Binance) yang punya candle
        sekecil itu untuk token on-chain. TF <b>30m/2h/3d/7d/1w/30d</b>{" "}
        dihitung dengan menggabungkan candle asli (resample), jadi token
        yang masih sangat baru wajar kalau muncul "data belum cukup" di TF
        besar.
      </InfoBox>

      <div className="controls">
        <select value={chain} onChange={(e) => setChain(e.target.value)}>
          {CHAINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Cari simbol/nama/contract address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button className="refresh" onClick={load} disabled={loading}>
          {loading ? "Memuat…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-box">Gagal ambil data: {error}</div>}

      {!error && !loading && tokens.length === 0 && (
        <div className="empty-state">Tidak ada token ditemukan.</div>
      )}

      {tokens.map((t) => (
        <TokenCard key={`${t.chainId}:${t.pairAddress}`} token={t} />
      ))}
    </div>
  );
}
