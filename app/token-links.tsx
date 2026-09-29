"use client";

import { useState } from "react";

/**
 * Status tiap sumber data (GMGN/Helius/Etherscan) — dipakai di tab Wallet
 * Watch & Pilih 3 Dompet buat nunjukin KENAPA sinyal kosong, bukan cuma
 * diam-diam kosong. ok=true tapi found=0 = sumbernya jalan normal, cuma
 * memang belum ada aktivitas. ok=false = sumbernya gagal, error berisi
 * alasan aslinya (biasanya API key belum di-set atau endpoint publik mati).
 */
export type SourceStatus = {
  source: string;
  ok: boolean;
  found: number;
  error: string | null;
  skipped: boolean;
};

export function SourceStatusLine({ statuses }: { statuses: SourceStatus[] }) {
  if (!statuses?.length) return null;
  return (
    <div className="source-status">
      {statuses.map((s) => {
        let text: string;
        let cls: string;
        if (s.skipped) {
          text = `${s.source}: n/a (chain ini tidak pakai sumber ini)`;
          cls = "skip";
        } else if (!s.ok) {
          text = `${s.source}: gagal — ${s.error ?? "unknown error"}`;
          cls = "fail";
        } else {
          text = `${s.source}: ok (${s.found})`;
          cls = "ok";
        }
        return (
          <span key={s.source} className={`source-status-chip ${cls}`} title={s.error ?? undefined}>
            {text}
          </span>
        );
      })}
    </div>
  );
}

export type KeyUsage = { keys: number; totalUsedToday: number; perKey?: { key: string; usedToday: number; cooldownSec: number }[] };

/** Baris status rotasi API key (GMGN / Etherscan / Helius) — biar kelihatan berapa key aktif & mana yang lagi cooldown. */
export function KeyUsageLine({ items }: { items: { name: string; usage?: KeyUsage | null }[] }) {
  const shown = items.filter((i) => i.usage && i.usage.keys > 0);
  if (shown.length === 0) return null;
  return (
    <div className="source-status">
      {shown.map(({ name, usage }) => {
        const cooling = (usage!.perKey ?? []).filter((k) => k.cooldownSec > 0).length;
        return (
          <span
            key={name}
            className={`source-status-chip ${cooling > 0 ? "fail" : "ok"}`}
            title={(usage!.perKey ?? []).map((k) => `${k.key}: ${k.usedToday} req${k.cooldownSec ? ` (cooldown ${k.cooldownSec}s)` : ""}`).join("\n")}
          >
            🔑 {name}: {usage!.keys - cooling}/{usage!.keys} key aktif · {usage!.totalUsedToday} req hari ini
          </span>
        );
      })}
    </div>
  );
}

/**
 * Format angka USD gaya internasional: $1.23M / $456.7k / $78 — BUKAN
 * "rb"/"jt". Dipakai buat semua price/mcap/liquidity/volume di seluruh app.
 */
export function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

/**
 * Logo asli tiap platform lewat favicon resminya (Google favicon service) —
 * bukan avatar/inisial buatan, dan tidak perlu hardcode path CDN yang bisa
 * berubah sewaktu-waktu. Stabil untuk domain manapun (tradingview.com,
 * pump.fun, dexscreener.com, geckoterminal.com, pluang.com, dst).
 */
export function faviconUrl(domain: string, size = 64): string {
  return `https://www.google.com/s2/favicons?sz=${size}&domain=${domain}`;
}

export const LOGO = {
  tradingview: faviconUrl("tradingview.com"),
  pumpfun: faviconUrl("pump.fun"),
  dexscreener: faviconUrl("dexscreener.com"),
  geckoterminal: faviconUrl("geckoterminal.com"),
  pluang: faviconUrl("pluang.com"),
};

/** pump.fun cuma ada di Solana — halaman coin-nya konsisten di /coin/{mint}. */
export function pumpFunUrl(mintAddress: string): string {
  return `https://pump.fun/coin/${mintAddress}`;
}

/**
 * Link "buka di X" pakai logo asli platform (bukan tulisan). title/aria-label
 * tetap ada teks buat screen reader & tooltip hover, sesuai request "logo
 * asli bukan tulisan" di kartu.
 */
export function IconLink({
  href,
  logo,
  label,
  className = "",
}: {
  href: string;
  logo: string;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`icon-link ${className}`}
      title={label}
      aria-label={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={label} width={18} height={18} />
    </a>
  );
}

/** Contract address dipotong + tombol salin (klik tidak buka link lain di sekitarnya). */
export function CopyCA({ address }: { address: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const short = address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;

  const doCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // fallback kalau Clipboard API diblokir (mis. koneksi non-https)
      const ta = document.createElement("textarea");
      ta.value = address;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      className="ca-copy mono"
      title={copied ? "Tersalin!" : `Salin contract address: ${address}`}
      onClick={doCopy}
    >
      CA: {short} {copied ? "✅" : "📋"}
    </button>
  );
}
