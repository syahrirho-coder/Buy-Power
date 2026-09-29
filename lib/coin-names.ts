/**
 * Nama lengkap tiap koin (buat ditampilkan di bawah ticker, persis kayak
 * tampilan list Pluang: mis. "QNT" + "Quant" di bawahnya). Diambil manual
 * dari screenshot tab Crypto > Spot Pluang (New, Gainers, Losers, Volume,
 * 52-Week High, Available On Pro) — sinkron sama daftar base di
 * `pluang-symbols.ts`. Kalau base tidak ketemu di sini, UI jatuh ke ticker
 * itu sendiri sebagai nama (lihat `coinName()` di bawah).
 */
export const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "Binance Coin",
  XRP: "Ripple",
  SOL: "Solana",
  TRX: "TRON",
  DOGE: "Dogecoin",
  LINK: "Chainlink",
  ADA: "Cardano",
  UNI: "Uniswap",
  LTC: "Litecoin",
  AVAX: "Avalanche",
  DOT: "Polkadot",
  ICP: "Internet Computer",
  POL: "Polygon",
  ATOM: "Cosmos",
  INJ: "Injective",
  TIA: "Celestia",

  "2Z": "DoubleZero",
  AMP: "Amp",
  "1000SATS": "SATS (Ordinals)",
  AUDIO: "Audius",
  TNSR: "Tensor",
  SPELL: "Spell Token",
  C98: "Coin98",
  MAV: "Maverick Protocol",
  TLM: "Alien Worlds",
  RESOLV: "Resolv",

  NEAR: "NEAR Protocol",
  QNT: "Quant",
  JST: "JUST",

  PYTH: "Pyth Network",
  Q: "Quack AI",
  W: "Wormhole",
  XVG: "Verge",
  QI: "BENQI",
  AGI: "Delysium",
  GLMR: "Moonbeam",
  TRIA: "Tria",

  XPL: "Plasma",
  H: "Humanity Protocol",
  BULLA: "Bulla",
  PHA: "Phala Network",
  JELLYJELLY: "Jelly-My-Jelly",
  COTI: "COTI",
  ONE: "Harmony",
  RARE: "SuperRare",
  SAGA: "Saga",
  QUICK: "QuickSwap",

  HYPE: "Hyperliquid",
  XAUT: "Tether Gold",
  ASTER: "Aster",
  PAXG: "PAX Gold",
  MORPHO: "Morpho",
  FARTCOIN: "Fartcoin",
  GOMINING: "GoMining",
  LINEA: "Linea",
  HOLO: "Holoworld AI",
  MOG: "Mog Coin",
  OPEN: "OpenLedger",
  AVNT: "Avantis",
  MIRA: "Mira",
  HEMI: "Hemi",
  SOPH: "Sophon",
};

/** Nama tampil buat sebuah base ticker — fallback ke ticker itu sendiri kalau belum ada di map. */
export function coinName(base: string): string {
  return COIN_NAMES[base.toUpperCase()] ?? base;
}
