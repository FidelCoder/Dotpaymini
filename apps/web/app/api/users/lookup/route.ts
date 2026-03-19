import { NextRequest, NextResponse } from "next/server";
import { lookupBackendRecipient } from "@/lib/api";
import { getSession } from "@/lib/session";

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
    const query = req.nextUrl.searchParams.get("q") || req.nextUrl.searchParams.get("query") || "";
    const recipient = await lookupBackendRecipient(query);

    return NextResponse.json({
      success: true,
      data: recipient,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to lookup recipient.";
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
