/**
 * Daftar URL logo asli (bukan placeholder/inisial) buat sebuah base symbol
 * (mis. "BTC", "SOL"), diurutkan dari yang paling mirip Pluang app dulu.
 * Komponen pemakai (CoinLogo) coba satu-satu pakai <img onError>, biar kalau
 * satu CDN tidak punya simbol itu (coin kecil/baru), otomatis lanjut ke CDN
 * berikutnya sebelum jatuh ke avatar huruf sebagai upaya terakhir.
 *
 * 1. image-cdn.pluang.com — inferred dari URL asli yang dipakai halaman
 *    aset Pluang sendiri (mis. .../asset-icons/btc_v1.svg untuk BTC), jadi
 *    ini yang paling "senada" dengan tampilan app Pluang. Tidak dijamin
 *    ada untuk semua base (bisa beda versi _v2 dst, atau tidak ke-listing),
 *    makanya tetap butuh fallback di bawah.
 * 2. cryptocurrency-icons (repo publik atomiclabs, dulu spothq) via jsDelivr
 *    — cakupan ratusan koin populer, format PNG warna 128px.
 * 3. CoinCap asset icons — cakupan luas lagi buat top ratusan coin by
 *    market cap.
 */
export function cexLogoCandidates(base: string): string[] {
  const lower = base.toLowerCase();
  return [
    `https://image-cdn.pluang.com/icons/light/cryptocurrency/asset-icons/${lower}_v1.svg`,
    `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1.20.0/128/color/${lower}.png`,
    `https://assets.coincap.io/assets/icons/${lower}@2x.png`,
  ];
}

/** Link "trade di Pluang" — pakai konvensi pair CFX Pluang: BASE-IDR. */
export function pluangTradeUrl(base: string): string {
  return `https://trade.pluang.com/en/trade/${base.toUpperCase()}-IDR`;
}

/** Map source exchange dari hasil scan ke prefix simbol TradingView. */
export function tradingViewExchangePrefix(
  source: string
): "BINANCE" | "BYBIT" | "OKX" | null {
  switch (source) {
    case "binance":
      return "BINANCE";
    case "bybit":
      return "BYBIT";
    case "okx":
      return "OKX";
    default:
      return null;
  }
}

export function tradingViewUrl(exchangePrefix: string, symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${exchangePrefix}:${symbol}`;
}
