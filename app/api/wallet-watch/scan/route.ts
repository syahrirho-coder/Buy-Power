import { NextRequest, NextResponse } from "next/server";
import { scanWallets } from "@/lib/wallet-watch/tracker";
import { getHeliusUsage } from "@/lib/wallet-watch/sources/helius-keys";
import { getGmgnUsage } from "@/lib/gmgn/client";
import { getEtherscanUsage } from "@/lib/wallet-watch/sources/etherscan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain") ?? "sol";
  const wallets = searchParams.getAll("wallet").filter(Boolean);
  const minWalletsForSignal = Math.max(
    2,
    parseInt(searchParams.get("minWalletsForSignal") ?? "3", 10) || 3
  );

  if (wallets.length === 0) {
    return NextResponse.json(
      { error: "Minimal 1 parameter 'wallet' wajib diisi (bisa diulang, misal ?wallet=A&wallet=B)" },
      { status: 400 }
    );
  }
  if (wallets.length > 20) {
    return NextResponse.json({ error: "Maksimal 20 dompet per scan (biar tidak kena rate limit sumber data)" }, { status: 400 });
  }

  try {
    const result = await scanWallets(chain, wallets, { minWalletsForSignal });
    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      chain,
      wallets,
      ...result,
      heliusUsage: chain === "sol" ? getHeliusUsage() : undefined,
      gmgnUsage: getGmgnUsage(),
      etherscanUsage: chain !== "sol" ? getEtherscanUsage() : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 502 });
  }
}
