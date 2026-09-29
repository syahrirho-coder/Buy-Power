import { NextRequest, NextResponse } from "next/server";
import { computeWalletHealth } from "@/lib/gmgn/wallet-health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain");
  const address = searchParams.get("address");

  if (!chain || !address) {
    return NextResponse.json({ error: "Wajib isi query param `chain` dan `address`." }, { status: 400 });
  }

  try {
    const health = await computeWalletHealth(chain, address);
    return NextResponse.json(health);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 502 });
  }
}
