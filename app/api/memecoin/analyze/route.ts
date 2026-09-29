import { NextRequest, NextResponse } from "next/server";
import { analyzeMemecoinTf } from "@/lib/memecoin/analyze";
import { MEMECOIN_TIMEFRAMES, MemecoinTf } from "@/lib/memecoin/timeframes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network");
  const pool = searchParams.get("pool");
  const tfParam = searchParams.get("tf"); // comma-separated, mis. "1h,4h,1d"

  if (!network || !pool) {
    return NextResponse.json(
      { error: "Wajib isi query param `network` (slug GeckoTerminal) dan `pool` (pair address)." },
      { status: 400 }
    );
  }

  const requestedTfs: MemecoinTf[] = tfParam
    ? (tfParam.split(",").filter((t) => (MEMECOIN_TIMEFRAMES as readonly string[]).includes(t)) as MemecoinTf[])
    : ["1h", "4h", "1d"];

  if (requestedTfs.length === 0) {
    return NextResponse.json({ error: "Tidak ada timeframe valid di param `tf`." }, { status: 400 });
  }

  // GeckoTerminal rate limit 30/menit gratis — jalankan berurutan (bukan
  // paralel) supaya satu klik "analisa" per token tidak langsung
  // menghabiskan jatah request buat token lain yang sedang dibuka user lain.
  const results = [];
  for (const tf of requestedTfs) {
    results.push(await analyzeMemecoinTf(network, pool, tf));
  }

  return NextResponse.json({
    network,
    pool,
    updatedAt: new Date().toISOString(),
    results,
  });
}
