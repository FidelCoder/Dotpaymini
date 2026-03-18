import { NextRequest, NextResponse } from "next/server";
import { setBackendPin } from "@/lib/api";
import { getSession, updateSessionProfile } from "@/lib/session";

export async function PATCH(req: NextRequest) {
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
    const body = (await req.json()) as { pin?: string; oldPin?: string | null };
    const userProfile = await setBackendPin(session.walletAddress, body.pin || "", body.oldPin || null);
    const nextSession = updateSessionProfile(session, userProfile);

    return NextResponse.json({
      success: true,
      data: nextSession,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to set PIN.";
    const status = /invalid pin/i.test(message)
      ? 401
      : /required/i.test(message) || /exactly/i.test(message)
        ? 400
        : 500;

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}
