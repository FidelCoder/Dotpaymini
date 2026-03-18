import { NextRequest, NextResponse } from "next/server";
import { createBackendTransactionQuote } from "@/lib/api";
import { getSession } from "@/lib/session";
import type { TransactionFlowType } from "@/lib/product";

type QuoteRequest = {
  flowType?: TransactionFlowType;
  amount?: number;
  currency?: "KES" | "USD";
  phoneNumber?: string | null;
  paybillNumber?: string | null;
  tillNumber?: string | null;
  accountReference?: string | null;
  businessId?: string | null;
  idempotencyKey?: string | null;
};

export async function POST(req: NextRequest) {
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
    const body = (await req.json()) as QuoteRequest;
    const result = await createBackendTransactionQuote({
      userAddress: session.walletAddress,
      flowType: body.flowType || "offramp",
      amount: Number(body.amount),
      currency: body.currency || "KES",
      phoneNumber: body.phoneNumber || null,
      paybillNumber: body.paybillNumber || null,
      tillNumber: body.tillNumber || null,
      accountReference: body.accountReference || null,
      businessId: body.businessId || null,
      idempotencyKey: body.idempotencyKey || null,
    });

    return NextResponse.json({
      success: true,
      data: result,
      idempotent: result.idempotent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create quote.";
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 400 }
    );
  }
}
