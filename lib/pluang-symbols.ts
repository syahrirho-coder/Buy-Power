/**
 * Daftar base ticker crypto yang tersedia di tab "Crypto" (Spot) app Pluang.
 *
 * Kenapa perlu ini: universe lama (`fetchTopSymbols` versi awal) narik
 * SEMUA pair USDT dari Binance ticker/24hr, padahal tidak semua coin yang
 * ada di Binance/Bybit/OKX itu bisa dibeli di Pluang. Supaya scanner cuma
 * nunjukin koin yang beneran bisa di-eksekusi user di Pluang, universe-nya
 * dipersempit ke daftar ini.
 *
 * Sumbernya: screenshot tab Volume, 52-Week High, Gainers, Losers,
 * "Available On Pro", dan New di Crypto > Spot Pluang (per 27 Sep 2026).
 * Ini BUKAN daftar lengkap resmi dari API Pluang (tidak ada API publik
 * Pluang buat listing semua koin) — jadi kalau ada koin baru yang di-listing
 * Pluang tapi belum kelihatan di screenshot manapun, tambahkan manual di
 * bawah. Stablecoin (USDT, USDC, PYUSD, USDTB, FDUSD) sengaja tidak
 * dimasukkan karena itu quote asset, bukan koin yang mau di-scan.
 */
export const PLUANG_BASES = new Set<string>([
  // --- Available On Pro (major caps) ---
  "BTC",
  "ETH",
  "BNB",
  "XRP",
  "SOL",
  "TRX",
  "DOGE",
  "LINK",
  "ADA",
  "UNI",
  "LTC",
  "AVAX",
  "DOT",
  "ICP",
  "POL",
  "ATOM",
  "INJ",
  "TIA",

  // --- Volume tab ---
  "2Z",
  "AMP",
  "1000SATS",
  "AUDIO",
  "TNSR",
  "SPELL",
  "C98",
  "MAV",
  "TLM",
  "RESOLV",

  // --- 52-Week High tab ---
  "NEAR",
  "QNT",
  "JST",

  // --- Gainers tab ---
  "PYTH",
  "Q",
  "W",
  "XVG",
  "QI",
  "AGI",
  "GLMR",
  "TRIA",

  // --- Losers tab ---
  "XPL",
  "H",
  "BULLA",
  "PHA",
  "JELLYJELLY",
  "COTI",
  "ONE",
  "RARE",
  "SAGA",
  "QUICK",

  // --- New tab ---
  "HYPE",
  "XAUT",
  "ASTER",
  "PAXG",
  "MORPHO",
  "FARTCOIN",
  "GOMINING",
  "LINEA",
  "HOLO",
  "MOG",
  "OPEN",
  "AVNT",
  "MIRA",
  "HEMI",
  "SOPH",
]);
