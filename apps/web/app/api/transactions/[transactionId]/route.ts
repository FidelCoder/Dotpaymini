import { NextRequest, NextResponse } from "next/server";
import { getBackendTransaction } from "@/lib/api";
import { getSession } from "@/lib/session";

type Context = {
  params: {
    transactionId: string;
  };
};

export async function GET(_req: NextRequest, context: Context) {
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
    const transaction = await getBackendTransaction(context.params.transactionId);
    if (transaction.userAddress !== session.walletAddress) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load transaction.";
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}
