import { getTopTraders } from "./client";

export type MomentumCheck = {
  windowMinutes: number;
  recentBuyerCount: number;
  recentSellerCount: number;
  netInflowUsd: number;
  verdict: "momentum masuk" | "netral" | "momentum keluar";
  reason: string;
};

/**
 * Beda dengan wallet-health.ts (yang ngukur SEBARAN dompet secara total),
 * ini ngukur ARAH aktivitas TERBARU: apakah top trader lagi net-beli atau
 * net-jual dalam N menit terakhir. Tujuannya nangkep kasus "smart money
 * udah pegang dari lama tapi sekarang diam-diam keluar" — yang tidak
 * kelihatan dari smart_degen_count doang (itu snapshot holder, bukan arah
 * transaksi baru).
 *
 * CATATAN VERIFIKASI (sama seperti getWalletActivity di client.ts): field
 * buy_tx_count_cur / buy_volume_cur / sell_tx_count_cur / sell_volume_cur /
 * addr_type dari /v1/market/token_top_traders SUDAH terverifikasi jalan
 * (dipakai di wallet-health.ts). Tapi field timestamp aktivitas terakhir —
 * dicoba di sini sebagai `last_active_timestamp` — BELUM terverifikasi 100%
 * karena GMGN tidak publikasikan dokumentasi resmi terbuka untuk
 * openapi.gmgn.ai. Kalau recentBuyerCount/recentSellerCount SELALU 0 padahal
 * token-nya jelas aktif, console.log traders[0] mentah di sini sebentar,
 * cari field timestamp yang benar (kandidat lain: `last_trade_timestamp`,
 * `last_active_time`, `update_timestamp`), lalu ganti key di bawah.
 */
export async function computeMomentum(
  chain: string,
  address: string,
  windowMinutes = 60
): Promise<MomentumCheck> {
  const traders = await getTopTraders(chain, address, 100);
  const realTraders = traders.filter((t) => t.addr_type === 0);

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec - windowMinutes * 60;
  const lastActive = (t: any): number => t.last_active_timestamp ?? t.last_trade_timestamp ?? 0;

  const recentBuyers = realTraders.filter((t) => (t.buy_tx_count_cur ?? 0) > 0 && lastActive(t) >= cutoff);
  const recentSellers = realTraders.filter((t) => (t.sell_tx_count_cur ?? 0) > 0 && lastActive(t) >= cutoff);

  const recentBuyVol = recentBuyers.reduce((s, t) => s + (t.buy_volume_cur ?? 0), 0);
  const recentSellVol = recentSellers.reduce((s, t) => s + (t.sell_volume_cur ?? 0), 0);
  const netInflowUsd = recentBuyVol - recentSellVol;

  let verdict: MomentumCheck["verdict"];
  let reason: string;
  if (recentBuyers.length > recentSellers.length * 1.5 && netInflowUsd > 0) {
    verdict = "momentum masuk";
    reason = `${recentBuyers.length} wallet aktif beli vs ${recentSellers.length} jual dalam ${windowMinutes} menit terakhir, net inflow ~$${netInflowUsd.toFixed(0)}.`;
  } else if (recentSellers.length > recentBuyers.length * 1.5 && netInflowUsd < 0) {
    verdict = "momentum keluar";
    reason = `${recentSellers.length} wallet aktif jual vs ${recentBuyers.length} beli dalam ${windowMinutes} menit terakhir, net outflow ~$${Math.abs(netInflowUsd).toFixed(0)} — waspada, bisa jadi smart money lagi keluar diam-diam.`;
  } else {
    verdict = "netral";
    reason = `${recentBuyers.length} wallet beli vs ${recentSellers.length} jual dalam ${windowMinutes} menit terakhir — belum ada dorongan jelas satu arah.`;
  }

  return { windowMinutes, recentBuyerCount: recentBuyers.length, recentSellerCount: recentSellers.length, netInflowUsd, verdict, reason };
}
