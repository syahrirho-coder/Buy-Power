/**
 * Universe forex + emas untuk tab CEX (sumber data: Twelve Data).
 *
 * Dibatasi 12 instrumen sengaja: 12 simbol x 6 timeframe = 72 credit per scan,
 * muat di jatah 10 key x 8 credit/menit (=80/menit) jadi 1x scan selesai
 * tanpa nunggu window menit berikutnya. Mau nambah pair? Tambah di bawah
 * (tiap pair baru = +6 credit per scan; lewat 80 credit scan akan menunggu
 * ke menit berikutnya dan bisa kena batas waktu function).
 */
export type FxInstrument = { symbol: string; base: string; name: string; kind: "forex" | "gold" };

export const FX_INSTRUMENTS: FxInstrument[] = [
  { symbol: "XAU/USD", base: "XAUUSD", name: "Gold / US Dollar", kind: "gold" },
  { symbol: "EUR/USD", base: "EURUSD", name: "Euro / US Dollar", kind: "forex" },
  { symbol: "GBP/USD", base: "GBPUSD", name: "British Pound / US Dollar", kind: "forex" },
  { symbol: "USD/JPY", base: "USDJPY", name: "US Dollar / Japanese Yen", kind: "forex" },
  { symbol: "USD/CHF", base: "USDCHF", name: "US Dollar / Swiss Franc", kind: "forex" },
  { symbol: "AUD/USD", base: "AUDUSD", name: "Australian Dollar / US Dollar", kind: "forex" },
  { symbol: "USD/CAD", base: "USDCAD", name: "US Dollar / Canadian Dollar", kind: "forex" },
  { symbol: "NZD/USD", base: "NZDUSD", name: "New Zealand Dollar / US Dollar", kind: "forex" },
  { symbol: "EUR/GBP", base: "EURGBP", name: "Euro / British Pound", kind: "forex" },
  { symbol: "EUR/JPY", base: "EURJPY", name: "Euro / Japanese Yen", kind: "forex" },
  { symbol: "GBP/JPY", base: "GBPJPY", name: "British Pound / Japanese Yen", kind: "forex" },
  { symbol: "AUD/JPY", base: "AUDJPY", name: "Australian Dollar / Japanese Yen", kind: "forex" },
];
