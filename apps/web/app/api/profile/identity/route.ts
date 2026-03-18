import { NextRequest, NextResponse } from "next/server";
import { setBackendIdentity } from "@/lib/api";
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
    const body = (await req.json()) as { username?: string };
    const userProfile = await setBackendIdentity(session.walletAddress, body.username || "");
    const nextSession = updateSessionProfile(session, userProfile);

    return NextResponse.json({
      success: true,
      data: nextSession,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update profile.";
    const status = /taken/i.test(message) ? 409 : 400;

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}
