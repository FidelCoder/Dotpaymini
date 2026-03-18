import { NextRequest, NextResponse } from "next/server";
import { listBackendTransactions } from "@/lib/api";
import { getSession } from "@/lib/session";
import type { TransactionFlowType } from "@/lib/product";

export async function GET(req: NextRequest) {
  const session = getSession();
  if (!session) {
    return NextResponse.json(
      {
        success: false,
        message: "Unauthorized.",
      },
      { status: 401 }
    );
  }

  try {
    const searchParams = req.nextUrl.searchParams;
    const transactions = await listBackendTransactions({
      userAddress: session.walletAddress,
      flowType: (searchParams.get("flowType") as TransactionFlowType | null) || undefined,
      status: searchParams.get("status") || undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        transactions,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load transactions.";
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 400 }
    );
  }
}
