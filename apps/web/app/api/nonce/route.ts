import { NextResponse } from "next/server";
import { setNonceCookie } from "@/lib/session";

export async function GET() {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  setNonceCookie(nonce);

  return NextResponse.json({ nonce });
}
