# Buy Power Scanner

Next.js app yang scan pair USDT teraktif di Binance, hitung ulang logika
indikator **ChartPrime — S&R Power Channel** (rolling high/low 130 candle
± ATR(200)×0.5), lalu tandai koin yang harganya sedang berada di **buy
power zone** (channel bawah) atau **sell power zone** (channel atas) di
5m, 15m, 30m, 1h, 4h, dan 1d. Yang netral disembunyikan.

Tab CEX punya 2 pasar: **Crypto** (Binance → Bybit → OKX) dan **Forex & Gold**
(Twelve Data, rotasi sampai 10 API key — lihat `TWELVEDATA_API_KEYS` di
`.env.example`, daftar pair di `lib/forex-symbols.ts`). Filter di UI: Buy + Sell /
Buy zone / Sell zone, plus chip TF buat memilih timeframe mana yang dihitung.

## Jalanin lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

## Deploy ke Vercel

1. Push folder ini ke repo GitHub/GitLab, lalu import di [vercel.com/new](https://vercel.com/new).
   Atau langsung: `npx vercel` dari folder ini.
2. Crypto tidak butuh API key (Binance, Bybit, OKX publik gratis). Tab Forex &
   Gold butuh `TWELVEDATA_API_KEYS` (1-10 key dipisah koma) di Environment Variables.
3. **Penting soal durasi fungsi:** route `/api/scan` men-scan ~70 simbol ×
   6 timeframe = ~420 request ke exchange, jalan lewat serverless function.
   Di plan **Hobby**, durasi default function dibatasi 10 detik kecuali
   kamu aktifkan Fluid Compute (Vercel > Project Settings > Functions).
   Kalau kena timeout:
   - kecilkan universe lewat query param, mis. `/api/scan?limit=40`, atau
   - upgrade ke plan yang izinkan `maxDuration` lebih panjang (sudah di-set 60s di kode).

## Batasan yang perlu kamu tahu

- **ATR di-seed dari 400 candle terakhir**, bukan dari seluruh histori
  chart seperti TradingView. Wilder's RMA konvergen secara eksponensial,
  jadi setelah ~200+ candle nilainya sudah sangat dekat ke versi
  TradingView, tapi tidak dijamin identik 100% — kalau butuh presisi
  persis sama seperti di chart, cross-check manual pair yang match.
- **Rate limit exchange**: IP shared Vercel kadang kena 429 dari Binance
  saat traffic tinggi. Kode sudah fallback otomatis ke Bybit lalu OKX per
  simbol per timeframe, tapi kalau ketiganya kena limit bersamaan, simbol
  itu akan muncul sebagai `n/a` di tabel (bukan dianggap "tidak match").
- **Bukan indikator entry/exit otomatis.** Zona ini hanya menandai area
  dimana Pine Script aslinya juga cuma menggambar channel — ini bukan
  jaminan reversal. Anggap sebagai filter awal buat watchlist, bukan
  sinyal final.
- Universe simbol dibatasi ke koin yang tersedia di app **Pluang** (lihat
  `lib/pluang-symbols.ts`), bukan semua pair USDT di Binance. Volume 24h
  (buat sorting) tetap ditarik dari Binance kalau ada, tapi koin yang cuma
  listing di Bybit/OKX (tidak ada di Binance spot) tetap ikut di-scan dengan
  volume 0. Daftar ini disusun manual dari screenshot app Pluang (tidak ada
  API publik Pluang buat list semua koin) — kalau Pluang nambah listing
  baru, tambahkan basenya manual ke `PLUANG_BASES`.
- **Logo & link di tiap kartu (`lib/crypto-logo.ts`)**: logo asli dicoba
  dari CDN `image-cdn.pluang.com` dulu (biar senada sama tampilan app
  Pluang), lalu fallback ke `cryptocurrency-icons` (jsDelivr) dan CoinCap
  kalau tidak ketemu, baru jatuh ke avatar huruf sebagai upaya terakhir.
  Tiap kartu juga dikasih dua link langsung: **"Buka di Pluang"** (pola
  `trade.pluang.com/en/trade/BASE-IDR` — konvensi pair CFX Pluang, dibangun
  dari base symbol, bukan dari API listing resmi, jadi kalau ternyata
  simbolnya belum/tidak listing di Pluang, halaman itu sendiri yang akan
  bilang not-found) dan **TradingView asli** (`BINANCE:`/`BYBIT:`/`OKX:` +
  simbol, dipilih dari exchange sumber data yang berhasil buat koin itu).

## Mode Memecoin (DEX) — tambahan baru

Tab kedua di dashboard untuk scan token memecoin (baru maupun lama) dari
DexScreener/GeckoTerminal/pump.fun/Raydium dkk, dengan link langsung dan
timeframe lengkap sesuai yang diminta. Sebelum pakai, penting paham
batasan asli tiap sumber data — semua sudah dicek ke API resminya:

- **DexScreener**: dipakai untuk *nemuin token* (boosted + profile token
  baru, cakupan semua chain termasuk pump.fun/Raydium/PumpSwap) dan buat
  link langsung ke halaman DexScreener-nya (logo di tiap kartu = link ini).
  **DexScreener API resmi tidak punya endpoint candle/OHLCV sama sekali**
  — jadi dia tidak dipakai untuk hitung zona buy/sell power.
- **GeckoTerminal**: satu-satunya sumber candle on-chain gratis yang ada,
  dipakai untuk hitung zona (logika sama persis dengan mode CEX: ATR 200 ×
  0.5, channel 130). Resolusi asli yang mereka dukung cuma **minute
  (1/5/15), hour (1/4/12), day (1)**. Rate limit 30 request/menit, tanpa
  API key.
- **Bitget**: dicek diam-diam di belakang layar cuma untuk satu hal — kalau
  simbol token itu ternyata *juga* listing spot di Bitget/Binance, link
  "Chart" akan jadi link **tradingview.com asli** (`BITGET:XXXUSDT` atau
  `BINANCE:XXXUSDT`). Kalau tidak listing di exchange manapun (murni token
  DEX baru), tidak ada link tradingview.com yang valid untuk token itu —
  TradingView cuma index simbol dari exchange yang mereka daftar, bukan
  sembarang pool DEX. Jadi fallback-nya link ke GeckoTerminal (chart
  mereka sendiri juga pakai TradingView charting library sebagai widget,
  tapi bukan domain tradingview.com).
- **Cakupan token — jangan salah ekspektasi**: DexScreener **tidak
  punya endpoint "list semua token"**. Feed discovery yang dipakai
  (`token-boosts/latest` + `token-profiles/latest`) masing-masing cuma
  balikin **~30 item per panggilan** dan isinya condong ke token yang
  **baru launch/lagi promosi**. Jadi hasil "Refresh" itu realistisnya
  **~40-60 token unik yang baru/lagi rame**, bukan seluruh memecoin yang
  pernah ada (itu jutaan pair di semua chain, tidak ada API gratis yang
  bisa list semuanya sekaligus). Untuk nutup token **lama/besar** yang
  jarang muncul lagi di feed boosted (BONK, WIF, PEPE, dst), ditambahkan
  `LEGACY_MEMECOIN_WATCHLIST` di `lib/memecoin/dexscreener.ts` yang
  di-resolve lewat search API (bukan hardcode contract address, biar
  tidak salah alamat) — silakan tambah/ganti simbol di daftar itu sesuai
  token lama yang mau selalu muncul.
- **pump.fun**: tidak punya API publik resmi. Token pump.fun (baik yang
  masih di bonding curve maupun yang sudah migrasi ke Raydium/PumpSwap)
  tetap muncul karena sudah terindeks di DexScreener & GeckoTerminal
  dengan `dexId` mengandung "pump" — ditandai badge **pump.fun** di kartu.
- **Timeframe 1s/3s/5s dihapus total dari UI** — TIDAK ADA sumber data
  gratis manapun (termasuk Binance) yang menyediakan candle sekecil ini
  untuk aset selain order-book tick data berbayar, jadi daripada
  ditampilkan non-klik (membingungkan), sekarang tidak muncul sama sekali
  di daftar TF.
- **Timeframe 30m/2h/3d/7d/1w/30d**: bukan resolusi native GeckoTerminal,
  jadi dihitung dengan *resample* (gabungkan beberapa candle native jadi
  satu candle lebih besar) di `lib/memecoin/timeframes.ts`. Token yang
  masih sangat baru wajar muncul "data belum cukup" di TF besar karena
  butuh 201+ candle di resolusi itu untuk ATR(200) — mis. TF 30d perlu
  ~6000 hari histori harga, jelas tidak akan dimiliki token yang baru
  lahir minggu ini.
- Analisa zona dijalankan **on-demand per token** (klik "Analisa zona per
  TF"), lalu bisa klik TF satu-satu atau klik **"Cek semua TF sekaligus"**
  buat nge-loop semua TF yang belum dicek (dengan jeda ~250ms per
  panggilan supaya tidak langsung menghabiskan jatah 30 req/menit
  GeckoTerminal). Filter **"Hanya tampilkan yang di buy power zone"** aktif
  default: TF yang hasilnya sell zone/netral/error otomatis disembunyikan
  dari tampilan, cuma yang match buy zone yang kelihatan (bisa dimatikan
  per-token kalau mau lihat semua hasil).

## Tab "🚀 Potensi 100x" (Smart Money / GMGN) — tambahan baru

Tab ketiga menyaring token yang ada jejak **smart money** dan/atau **KOL**
di dalamnya, plus fitur cek kesehatan wallet independen. **Beda dari 2 tab
sebelumnya — ini pakai GMGN API yang butuh API key berbayar milik sendiri**,
bukan API gratis publik.

### Setup wajib

1. Daftar & apply API key di https://gmgn.ai/ai
2. Buat file `.env` di root project (contoh di `.env.example`), isi:
   ```
   GMGN_API_KEYS=key1,key2,key3,key4,key5   # sampai 5 key, dirotasi otomatis (GMGN_API_KEY tunggal tetap didukung)
   ```
3. **Tidak perlu `GMGN_PRIVATE_KEY`** — tab ini cuma baca data (screening +
   analisa), tidak melakukan swap/trading, jadi cukup API key saja.
4. Rate limit tergantung tier: Free `5 request/detik`, Plus `20/detik`, Pro
   `50/detik`. Free tier cukup untuk pemakaian personal biasa; kalau kena
   429 tunggu beberapa detik atau upgrade tier.

### Cara kerja

- **Discovery** (`/api/gmgn/discover`): panggil `POST /v1/trenches` (token
  launchpad — new/near-completion/completed) dengan filter server-side
  `min_smart_degen_count≥1` + `max_rug_ratio 0.3` + `max_bundler_rate 0.3` +
  `max_insider_ratio 0.3`, lalu disaring lagi di kode dengan 4 kriteria
  contoh: **jumlah smart money**, **jumlah KOL**, **rasio buy/sell 24h**,
  **top10 holder rate** — diadaptasi dari kriteria "Pass/Watch/Skip" di
  dokumentasi resmi GMGN.
- **Cek wallet independen** (`/api/gmgn/wallet-health`, on-demand per
  token): panggil `GET /v1/market/token_top_traders`, hitung berapa wallet
  independen (`addr_type=0`, punya `buy_tx_count_cur>0`) yang benar-benar
  beli, lalu bandingkan share transaksi & volume dari **10 wallet
  teratas**. Ini persis logika yang diminta: **≥50 wallet independen dengan
  transaksi tidak menumpuk di top 10 (<40%) = sehat**; **<15 wallet atau
  top 10 menguasai >70% transaksi = mirip pola beberapa dompet yang
  transaksi berulang-ulang**, bukan banyak pembeli asli. Dihitung on-demand
  (bukan bulk) karena tiap panggilan makan jatah rate limit.
- **Bukan jaminan 100x.** Semua ini adalah saringan berbasis data
  on-chain (smart money tag, rasio transaksi, konsentrasi wallet) — bukan
  prediksi harga. Token yang lolos screening tetap bisa turun/rug. Selalu
  DYOR (Do Your Own Research) sebelum masuk.

## Struktur

```
app/
  api/scan/route.ts   -> serverless endpoint yang melakukan scan
  page.tsx            -> dashboard
  layout.tsx, globals.css
lib/
  indicator.ts         -> port logika Pine Script (ATR, zona buy/sell)
  exchanges.ts          -> fetcher Binance/Bybit/OKX + daftar simbol
  concurrency.ts        -> batching request biar tidak timeout
```

## Helius: rotasi 5 API key (versi hemat)

Tab **Wallet Watch / Pilih 3 Dompet** (chain Solana) memakai Helius.

```
HELIUS_API_KEYS=key1,key2,key3,key4,key5
HELIUS_DAILY_CREDITS_PER_KEY=30000   # opsional, batas lunak per key per hari
```

- Rotasi **otomatis**: tiap request pilih key yang paling sedikit dipakai hari ini;
  kalau kena 429/401/403 key itu di-cooldown dan request diulang ke key lain.
- Hemat: deteksi pembelian pakai `getSignaturesForAddress` (1 credit) +
  `getTransaction` (1 credit/tx baru, di-cache) — bukan Enhanced Transactions
  (100 credit/request). Holder token (DAS, 10 credit) di-cache 10 menit.
- Pemakaian per key dikirim di field `heliusUsage` pada response
  `/api/wallet-watch/scan` dan `/discover`.
- Counter ada di memori instance (reset saat cold start) — meter resmi tetap
  di dashboard.helius.dev.


## Forex & Gold (Twelve Data)

- Route `/api/scan-fx`: 12 instrumen (XAU/USD + 11 pair forex) × 5 TF Twelve Data = 60 credit
  per scan (TF 4h dari Tiingo, 0 credit Twelve Data). Dengan 10 key × 8 credit/menit = 80/menit,
  1 scan selesai tanpa nunggu menit berikutnya. Nambah pair di `lib/forex-symbols.ts` = +5 credit/pair;
  lewat 80 credit scan akan menunggu window menit berikutnya (batas waktu 52 detik).
- Candle di-cache di memori per (simbol, TF) beberapa menit, jadi klik Refresh
  berulang tidak menghabiskan credit. Cache & counter per instance serverless.
- Pasar forex tutup akhir pekan — data yang tampil = candle terakhir sebelum tutup.
- **4h**: Twelve Data tidak menyediakan 4h, jadi TF 4h diambil dari **Tiingo FX REST**
  (`lib/tiingo.ts`, `resampleFreq=4hour`, set `TIINGO_API_KEYS`). Kalau key kosong / Tiingo
  gagal, otomatis cadangan: gabung candle 1h Twelve Data jadi 4h (`lib/fx4h.ts`, +1 credit/pair).
- Pastikan plan key kamu mencakup XAU/USD (cek di dashboard Twelve Data);
  kalau ada yang ditolak, TF/pair itu muncul sebagai "n/a".
