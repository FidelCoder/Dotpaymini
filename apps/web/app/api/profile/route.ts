import { NextResponse } from "next/server";
import { getBackendUserProfile } from "@/lib/api";
import { getSession, updateSessionProfile } from "@/lib/session";

export async function GET() {
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
    const userProfile = await getBackendUserProfile(session.walletAddress);
    const nextSession = updateSessionProfile(session, userProfile);

    return NextResponse.json({
      success: true,
      data: nextSession,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile.";
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 }
    );
  }
}
