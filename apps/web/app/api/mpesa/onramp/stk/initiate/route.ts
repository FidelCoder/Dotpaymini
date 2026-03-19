import { NextRequest, NextResponse } from "next/server";
import { initiateBackendOnrampStk } from "@/lib/api";
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
      phoneNumber?: string;
      idempotencyKey?: string | null;
    };

    const transaction = await initiateBackendOnrampStk({
      transactionId: body.transactionId || "",
      quoteId: body.quoteId || null,
      userAddress: session.walletAddress,
      phoneNumber: body.phoneNumber || "",
      idempotencyKey: body.idempotencyKey || null,
    });

    return NextResponse.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initiate top up.";
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
