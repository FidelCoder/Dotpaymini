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
      pin?: string;
      signature?: string | null;
      signedAt?: string | null;
      nonce?: string | null;
    };

    const transaction = await initiateBackendPaybill({
      transactionId: body.transactionId || "",
      userAddress: session.walletAddress,
      pin: body.pin || "",
      signature: body.signature || null,
      signedAt: body.signedAt || null,
      nonce: body.nonce || null,
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
