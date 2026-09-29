import { NextRequest, NextResponse } from "next/server";
import { computeMomentum } from "@/lib/gmgn/momentum";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain");
  const address = searchParams.get("address");
  const windowMinutes = Math.min(parseInt(searchParams.get("window") ?? "60", 10) || 60, 24 * 60);

  if (!chain || !address) {
    return NextResponse.json({ error: "Wajib isi query param `chain` dan `address`." }, { status: 400 });
  }

  try {
    const momentum = await computeMomentum(chain, address, windowMinutes);
    return NextResponse.json(momentum);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 502 });
  }
}
