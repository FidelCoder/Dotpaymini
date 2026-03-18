import { NextRequest, NextResponse } from "next/server";
import { verifySiweMessage, type MiniAppWalletAuthSuccessPayload } from "@worldcoin/minikit-js";
import { syncWalletUserProfile } from "@/lib/api";
import { clearNonceCookie, getNonceCookie, setSessionCookie } from "@/lib/session";

type RequestPayload = {
  payload: MiniAppWalletAuthSuccessPayload;
  nonce: string;
  user?: {
    username?: string | null;
    profilePictureUrl?: string | null;
  };
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RequestPayload;
  const storedNonce = getNonceCookie();

  if (!storedNonce || body.nonce !== storedNonce) {
    return NextResponse.json(
      {
        isValid: false,
        message: "Invalid or expired nonce.",
      },
      { status: 400 }
    );
  }

  try {
    const verification = await verifySiweMessage(body.payload, body.nonce);
    if (!verification.isValid) {
      return NextResponse.json(
        {
          isValid: false,
          message: "SIWE verification failed.",
        },
        { status: 401 }
      );
    }

    const userProfile = await syncWalletUserProfile({
      address: body.payload.address,
      usernameHint: body.user?.username || null,
      profilePictureUrl: body.user?.profilePictureUrl || null,
      walletAuthVersion: body.payload.version,
    });

    setSessionCookie({
      walletAddress: body.payload.address,
      username: userProfile.username || userProfile.worldUsername || body.user?.username || null,
      profilePictureUrl: userProfile.profilePictureUrl || body.user?.profilePictureUrl || null,
      loggedInAt: new Date().toISOString(),
      userProfile,
    });
    clearNonceCookie();

    return NextResponse.json({
      isValid: true,
      address: body.payload.address,
      userProfile,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet Auth verification failed.";

    return NextResponse.json(
      {
        isValid: false,
        message,
      },
      { status: 500 }
    );
  }
}
