"use client";

import { useCallback, useEffect, useState } from "react";
import MemecoinPanel from "./memecoin-panel";
import GmgnPanel from "./gmgn-panel";
import WalletWatchPanel from "./wallet-watch-panel";
import WalletPickPanel from "./wallet-pick-panel";
import {
  cexLogoCandidates,
  pluangTradeUrl,
  tradingViewExchangePrefix,
  tradingViewUrl,
} from "@/lib/crypto-logo";
import { coinName } from "@/lib/coin-names";
import { InfoBox } from "./info-box";
import { IconLink, LOGO } from "./token-links";

const TABS: { key: "cex" | "memecoin" | "gmgn" | "walletwatch" | "walletpick"; icon: string; label: string }[] = [
  { key: "cex", icon: "💹", label: "CEX" },
  { key: "memecoin", icon: "🪙", label: "Memecoin" },
  { key: "gmgn", icon: "🚀", label: "Potensi 100x" },
  { key: "walletwatch", icon: "🔭", label: "Wallet Watch" },
  { key: "walletpick", icon: "🎯", label: "Pilih 3 Dompet" },
];

type TfKey = "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
const ALL_TFS: TfKey[] = ["5m", "15m", "30m", "1h", "4h", "1d"];

type Market = "crypto" | "forex";
type Side = "all" | "buy" | "sell";

type TfResult =
  | {
      timeframe: TfKey;
      price: number;
      inBuyZone: boolean;
      inSellZone: boolean;
      buyZone: { top: number; bottom: number };
      buyPower: number;
      sellPower: number;
      source: string;
    }
  | { timeframe: TfKey; error: string };

type SymbolResult = {
  symbol: string;
  name?: string;
  kind?: "forex" | "gold";
  volume: number;
  change24h: number | null;
  sparkline: number[];
  timeframes: TfResult[];
  buyCount: number;
  sellCount: number;
};

type ScanResponse = {
  updatedAt: string;
  scanned: number;
  matches: number;
  errors?: number;
  usage?: { keys: number; totalUsedToday: number; dailyBudgetPerKey: number };
  results: SymbolResult[];
};

function fmtPrice(n: number, market: Market = "crypto"): string {
  if (market === "forex") {
    if (n >= 100) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
    return n.toFixed(5);
  }
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function TfCell({ tf }: { tf: TfResult }) {
  if ("error" in tf) {
    return (
      <div className="tf-cell">
        <span className="tf-label">{tf.timeframe}</span>
        <span className="tf-badge error" title={tf.error}>
          n/a
        </span>
      </div>
    );
  }
  const badgeClass = tf.inBuyZone ? "buy" : tf.inSellZone ? "sell" : "neutral";
  const label = tf.inBuyZone ? "buy zone" : tf.inSellZone ? "sell zone" : "netral";
  return (
    <div className="tf-cell">
      <span className="tf-label">{tf.timeframe}</span>
      <span className={`tf-badge ${badgeClass}`}>{label}</span>
    </div>
  );
}

/**
 * Logo asli koin. Coba beberapa CDN publik berurutan lewat onError — kalau
 * semua gagal (koin sangat obscure), jatuh ke avatar huruf sebagai upaya
 * terakhir supaya layout tetap rapi (bukan broken image icon browser).
 */
function CoinLogo({ base }: { base: string }) {
  const candidates = cexLogoCandidates(base);
  const [idx, setIdx] = useState(0);

  if (idx >= candidates.length) {
    return (
      <span className="ds-logo-fallback" style={{ fontSize: 9, fontWeight: 700 }}>
        {base.slice(0, 3)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[idx]}
      alt=""
      width={22}
      height={22}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

function baseOf(symbol: string): string {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function fmtChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Mini chart naik-turun ala list Pluang: garis hijau kalau harga di sparkline
 * naik dari titik pertama ke terakhir, merah kalau turun. Datanya 24 close
 * candle 1h terakhir dari `/api/scan` (bukan request baru).
 */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div className="sparkline sparkline-empty" />;
  }
  const w = 72;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = data[data.length - 1] >= data[0];

  return (
    <svg
      className={`sparkline ${up ? "up" : "down"}`}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FxLogo({ symbol, kind }: { symbol: string; kind?: "forex" | "gold" }) {
  return (
    <span className="ds-logo-fallback" style={{ fontSize: 15, fontWeight: 700 }}>
      {kind === "gold" ? "🥇" : symbol.slice(0, 3)}
    </span>
  );
}

function FxLinks({ symbol }: { symbol: string }) {
  return (
    <div className="coin-actions">
      <IconLink
        href={tradingViewUrl("OANDA", symbol)}
        logo={LOGO.tradingview}
        label="Chart TradingView (OANDA)"
        className="tradingview"
      />
    </div>
  );
}

function CoinLinks({ base, timeframes }: { base: string; timeframes: TfResult[] }) {
  const okTf = timeframes.find((t): t is Extract<TfResult, { source: string }> => "source" in t);
  const exchangePrefix = okTf ? tradingViewExchangePrefix(okTf.source) : null;

  return (
    <div className="coin-actions">
      <IconLink
        href={pluangTradeUrl(base)}
        logo={LOGO.pluang}
        label="Buka pair ini langsung di Pluang (trade.pluang.com)"
        className="pluang"
      />
      {exchangePrefix && (
        <IconLink
          href={tradingViewUrl(exchangePrefix, `${base}USDT`)}
          logo={LOGO.tradingview}
          label={`Chart TradingView asli (${exchangePrefix})`}
          className="tradingview"
        />
      )}
    </div>
  );
}

export default function Page() {
  const [mode, setMode] = useState<"cex" | "memecoin" | "gmgn" | "walletwatch" | "walletpick">("cex");
  const [market, setMarket] = useState<Market>("crypto");
  const [dataByMarket, setDataByMarket] = useState<Record<Market, ScanResponse | null>>({
    crypto: null,
    forex: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("all");
  const [tfs, setTfs] = useState<TfKey[]>(ALL_TFS);

  const data = dataByMarket[market];

  const runScan = useCallback(async (m: Market) => {
    setLoading(true);
    setError(null);
    try {
      const url = m === "crypto" ? "/api/scan?limit=500" : "/api/scan-fx";
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDataByMarket((prev) => ({ ...prev, [m]: json }));
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!dataByMarket[market]) runScan(market);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, runScan]);

  const toggleTf = (tf: TfKey) =>
    setTfs((cur) => {
      if (cur.includes(tf)) return cur.length === 1 ? cur : cur.filter((x) => x !== tf);
      return ALL_TFS.filter((x) => x === tf || cur.includes(x));
    });

  // Netral disembunyikan: koin/pair tampil hanya kalau minimal 1 TF terpilih
  // sedang di buy zone / sell zone (sesuai filter sisi).
  const visible = (data?.results ?? [])
    .map((r) => {
      const inZone = r.timeframes.filter(
        (t): t is Extract<TfResult, { price: number }> =>
          "price" in t &&
          tfs.includes(t.timeframe) &&
          (side === "buy" ? t.inBuyZone : side === "sell" ? t.inSellZone : t.inBuyZone || t.inSellZone)
      );
      return { r, inZone };
    })
    .filter((x) => x.inZone.length > 0)
    .sort((a, b) => b.inZone.length - a.inZone.length);

  return (
    <div className="wrap">
      <div className="header">
        <div className="title-block">
          <h1>Buy Power Scanner</h1>
          <p>
            Cek koin / pair yang harganya lagi duduk di zona buy power
            (support channel) atau sell power (resistance channel) — logikanya
            diambil dari indikator S&amp;R Power Channel.
          </p>
        </div>
        <div className="legend">
          <span>
            <i className="dot buy" /> buy zone
          </span>
          <span>
            <i className="dot sell" /> sell zone
          </span>
        </div>
      </div>

      <div className="mode-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`mode-tab ${mode === t.key ? "active" : ""}`}
            onClick={() => setMode(t.key)}
          >
            <span className="mode-tab-icon">{t.icon}</span>
            <span className="mode-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {mode === "memecoin" ? (
        <MemecoinPanel />
      ) : mode === "gmgn" ? (
        <GmgnPanel />
      ) : mode === "walletwatch" ? (
        <WalletWatchPanel />
      ) : mode === "walletpick" ? (
        <WalletPickPanel />
      ) : (
        <>
      <div className="controls">
        <div className="seg">
          <button
            className={`seg-btn ${market === "crypto" ? "active" : ""}`}
            onClick={() => setMarket("crypto")}
          >
            🪙 Crypto
          </button>
          <button
            className={`seg-btn ${market === "forex" ? "active" : ""}`}
            onClick={() => setMarket("forex")}
          >
            💱 Forex &amp; Gold
          </button>
        </div>
        <button className="refresh" onClick={() => runScan(market)} disabled={loading}>
          {loading ? "Scanning…" : "Refresh scan"}
        </button>
        {data && (
          <span className="status-line">
            <span className="num">{visible.length}</span> tampil ·{" "}
            <span className="num">{data.scanned}</span> discan · update{" "}
            {new Date(data.updatedAt).toLocaleTimeString("id-ID")}
          </span>
        )}
      </div>

      <div className="controls filters">
        <div className="seg">
          {(["all", "buy", "sell"] as Side[]).map((sd) => (
            <button
              key={sd}
              className={`seg-btn ${side === sd ? "active" : ""} ${sd}`}
              onClick={() => setSide(sd)}
            >
              {sd === "all" ? "Buy + Sell" : sd === "buy" ? "Buy zone" : "Sell zone"}
            </button>
          ))}
        </div>
        <div className="tf-chips">
          {ALL_TFS.map((tf) => (
            <button
              key={tf}
              className={`tf-chip ${tfs.includes(tf) ? "on" : ""}`}
              onClick={() => toggleTf(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <InfoBox
        chips={[
          "📊 6 TF: 5m · 15m · 30m · 1h · 4h · 1d",
          "🙈 Netral disembunyikan",
          market === "forex" ? "💱 Twelve Data + Tiingo (4h)" : "🔗 Link Pluang + TradingView",
        ]}
      >
        Yang tampil hanya koin / pair yang <b>minimal di satu timeframe terpilih</b>{" "}
        sedang di <b>buy zone</b> (channel bawah) atau <b>sell zone</b> (channel
        atas). Yang netral di semua TF terpilih disembunyikan, begitu juga badge
        TF yang netral di dalam kartu. Pakai chip TF di atas buat memilih TF
        mana yang dihitung (mis. cuma 5m + 15m buat scalping). Kartu diurutkan
        dari yang paling banyak TF-nya masuk zona.
        {market === "forex" && data?.usage && (
          <>
            {" "}
            Forex &amp; gold ditarik dari <b>Twelve Data</b> (4h dari <b>Tiingo</b>) dengan{" "}
            <b>{data.usage.keys} API key</b> yang dirotasi otomatis (
            {data.usage.totalUsedToday} credit terpakai hari ini di instance ini).
          </>
        )}
      </InfoBox>

      {error && <div className="error-box">Gagal scan: {error}</div>}

      {!error && (
        <>
          {visible.length === 0 && !loading && (
            <div className="empty-state">
              {data
                ? "Tidak ada yang lagi di buy/sell zone untuk filter ini — semuanya netral."
                : "Belum ada data."}
            </div>
          )}

          {visible.map(({ r }) => {
            const isFx = market === "forex";
            const price = r.timeframes.find((t): t is Extract<TfResult, { price: number }> => "price" in t);
            const base = isFx ? r.symbol : baseOf(r.symbol);
            const changeClass =
              r.change24h === null ? "" : r.change24h >= 0 ? "up" : "down";
            const zoneTfs = r.timeframes.filter(
              (t) => "price" in t && (t.inBuyZone || t.inSellZone)
            );
            const failed = r.timeframes.filter((t) => "error" in t).length;
            const cardSide = r.buyCount >= r.sellCount ? "match" : "match-sell";
            return (
              <div key={r.symbol} className={`coin-card ${cardSide}`}>
                <div className="coin-card-top">
                  <span className="symbol">
                    <span className="ds-logo ds-logo-lg">
                      {isFx ? <FxLogo symbol={base} kind={r.kind} /> : <CoinLogo base={base} />}
                    </span>
                    <span className="coin-id-text">
                      <span className="ticker">{base}</span>
                      <span className="coin-name">{isFx ? r.name : coinName(base)}</span>
                    </span>
                  </span>

                  <Sparkline data={r.sparkline} />

                  <span className="coin-price-block">
                    <span className="price mono">
                      {price ? fmtPrice(price.price, market) : "—"}
                    </span>
                    <span className={`change mono ${changeClass}`}>
                      {fmtChange(r.change24h)}
                    </span>
                  </span>
                </div>
                <div className="tf-row">
                  {zoneTfs.map((tf) => (
                    <TfCell key={tf.timeframe} tf={tf} />
                  ))}
                  {failed > 0 && (
                    <span className="tf-fail" title="Data TF ini gagal diambil">
                      {failed} TF n/a
                    </span>
                  )}
                </div>
                {isFx ? <FxLinks symbol={base} /> : <CoinLinks base={base} timeframes={r.timeframes} />}
              </div>
            );
          })}
        </>
      )}

      <footer className="note">
        Sumber data crypto: Binance klines (utama), fallback otomatis ke Bybit
        lalu OKX kalau Binance gagal/limit. Forex &amp; gold: Twelve Data
        (rotasi sampai 10 API key). Zona dihitung dari rolling high/low
        130 candle ± (ATR 200 candle × 0.5), meniru persis logika indikator
        Pine aslinya. Ini bukan sinyal beli otomatis — tetap validasi manual
        sebelum entry. Link "Buka di Pluang" pakai konvensi pair BASE-IDR
        Pluang — kalau ternyata koin itu belum/tidak listing di Pluang,
        halamannya akan menampilkan pesan not-found dari Pluang sendiri.
      </footer>
        </>
      )}
    </div>
  );
}
