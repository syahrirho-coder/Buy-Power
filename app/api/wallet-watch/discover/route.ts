import { NextRequest, NextResponse } from "next/server";
import { discoverWallets } from "@/lib/wallet-watch/tracker";
import { getHeliusUsage } from "@/lib/wallet-watch/sources/helius-keys";
import { getGmgnUsage } from "@/lib/gmgn/client";
import { getEtherscanUsage } from "@/lib/wallet-watch/sources/etherscan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const chain = searchParams.get("chain") ?? "sol";
  const address = searchParams.get("address");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50);

  if (!address) {
    return NextResponse.json(
      { error: "Parameter 'address' (contract address token) wajib diisi" },
      { status: 400 }
    );
  }

  try {
    const { wallets, sourceStatus } = await discoverWallets(chain, address, limit);
    return NextResponse.json({ chain, tokenAddress: address, count: wallets.length, wallets,
      sourceStatus,
      heliusUsage: chain === "sol" ? getHeliusUsage() : undefined,
      gmgnUsage: getGmgnUsage(),
      etherscanUsage: chain !== "sol" ? getEtherscanUsage() : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 502 });
  }
}
