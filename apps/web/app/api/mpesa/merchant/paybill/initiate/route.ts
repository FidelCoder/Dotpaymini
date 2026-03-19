import { NextRequest, NextResponse } from "next/server";
import { initiateBackendPaybill } from "@/lib/api";
import { getSession } from "@/lib/session";

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
    const body = (await req.json()) as {
      transactionId?: string;
      quoteId?: string;
      pin?: string;
      idempotencyKey?: string | null;
      signature?: string | null;
      signedAt?: string | null;
      nonce?: string | null;
      onchainTxHash?: string | null;
      chainId?: number | null;
      phoneNumber?: string | null;
      paybillNumber?: string | null;
      accountReference?: string | null;
      businessId?: string | null;
      requester?: string | null;
    };

    const transaction = await initiateBackendPaybill({
      transactionId: body.transactionId || "",
      quoteId: body.quoteId || null,
      userAddress: session.walletAddress,
      pin: body.pin || "",
      idempotencyKey: body.idempotencyKey || null,
      signature: body.signature || null,
      signedAt: body.signedAt || null,
      nonce: body.nonce || null,
      onchainTxHash: body.onchainTxHash || null,
      chainId: body.chainId ?? null,
      phoneNumber: body.phoneNumber || null,
      paybillNumber: body.paybillNumber || null,
      accountReference: body.accountReference || null,
      businessId: body.businessId || null,
      requester: body.requester || null,
    });

    return NextResponse.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initiate PayBill.";
    const status = /unauthorized/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 400;
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}
