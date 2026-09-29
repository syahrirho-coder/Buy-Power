import { getTopTraders } from "./client";

export type WalletHealth = {
  distinctBuyerWallets: number;
  totalBuyTx: number;
  top10TxSharePct: number; // % dari total buy tx yang berasal dari 10 wallet teratas
  top10VolSharePct: number; // % dari total buy volume USD dari 10 wallet teratas
  avgTxPerWallet: number;
  verdict: "sehat" | "waspada" | "berisiko";
  reason: string;
};

/**
 * Implementasi konsep yang diminta: "50 pembeli sungguhan dengan volume
 * stabil > 500 transaksi dari 10 dompet". Dihitung dari
 * GET /v1/market/token_top_traders (field `buy_tx_count_cur`,
 * `buy_volume_cur`, `addr_type`) — bukan cuma dari `top_10_holder_rate`
 * (yang ngukur SALDO, bukan aktivitas beli), karena 10 wallet bisa
 * cuci-cuci transaksi tanpa harus jadi top holder saldo.
 */
export async function computeWalletHealth(chain: string, address: string): Promise<WalletHealth> {
  const traders = await getTopTraders(chain, address, 100);
  // addr_type 0 = wallet biasa; 2 = exchange/pool internal — bukan "pembeli".
  const realWallets = traders.filter((t) => t.addr_type === 0 && (t.buy_tx_count_cur ?? 0) > 0);

  const totalBuyTx = realWallets.reduce((s, t) => s + (t.buy_tx_count_cur ?? 0), 0);
  const totalBuyVol = realWallets.reduce((s, t) => s + (t.buy_volume_cur ?? 0), 0);

  const sortedByTx = [...realWallets].sort((a, b) => (b.buy_tx_count_cur ?? 0) - (a.buy_tx_count_cur ?? 0));
  const top10 = sortedByTx.slice(0, 10);
  const top10Tx = top10.reduce((s, t) => s + (t.buy_tx_count_cur ?? 0), 0);
  const top10Vol = top10.reduce((s, t) => s + (t.buy_volume_cur ?? 0), 0);

  const distinctBuyerWallets = realWallets.length;
  const top10TxSharePct = totalBuyTx > 0 ? (top10Tx / totalBuyTx) * 100 : 0;
  const top10VolSharePct = totalBuyVol > 0 ? (top10Vol / totalBuyVol) * 100 : 0;
  const avgTxPerWallet = distinctBuyerWallets > 0 ? totalBuyTx / distinctBuyerWallets : 0;

  // Ambang: banyak wallet independen + transaksi tidak menumpuk di segelintir
  // dompet = sehat. Sedikit wallet tapi transaksi menumpuk (rasio tx/wallet
  // tinggi DAN terkonsentrasi di top 10) = pola "500 tx dari 10 dompet".
  let verdict: WalletHealth["verdict"];
  let reason: string;
  if (distinctBuyerWallets >= 50 && top10TxSharePct < 40) {
    verdict = "sehat";
    reason = `${distinctBuyerWallets} wallet independen beli, top 10 wallet cuma ${top10TxSharePct.toFixed(0)}% dari total transaksi beli — konsensus tersebar.`;
  } else if (distinctBuyerWallets < 15 || top10TxSharePct > 70) {
    verdict = "berisiko";
    reason = `Cuma ${distinctBuyerWallets} wallet independen, top 10 wallet menguasai ${top10TxSharePct.toFixed(0)}% transaksi beli — mirip pola segelintir dompet yang transaksi berulang-ulang, bukan banyak pembeli asli.`;
  } else {
    verdict = "waspada";
    reason = `${distinctBuyerWallets} wallet independen, top 10 wallet ${top10TxSharePct.toFixed(0)}% dari transaksi beli — belum jelas kuat/lemah, perlu dicek manual.`;
  }

  return { distinctBuyerWallets, totalBuyTx, top10TxSharePct, top10VolSharePct, avgTxPerWallet, verdict, reason };
}
