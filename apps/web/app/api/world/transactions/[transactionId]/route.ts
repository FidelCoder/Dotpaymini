import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

type Context = {
  params: {
    transactionId: string;
  };
};

type WorldTransactionStatus = "pending" | "mined" | "failed";

type RawWorldTransaction = {
  transactionId?: string;
  transaction_id?: string;
  transactionHash?: string | null;
  transaction_hash?: string | null;
  transactionStatus?: string | null;
  transaction_status?: string | null;
  miniappId?: string | null;
  mini_app_id?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  network?: string | null;
  chain?: string | null;
  fromWalletAddress?: string | null;
  from_wallet_address?: string | null;
  toContractAddress?: string | null;
  to_contract_address?: string | null;
  reference?: string | null;
  timestamp?: string | null;
};

function normalizeStatus(value: unknown): WorldTransactionStatus {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "mined" || normalized === "confirmed" || normalized === "success") {
    return "mined";
  }

  if (normalized === "failed" || normalized === "error" || normalized === "reverted") {
    return "failed";
  }

  return "pending";
}

function getWorldConfig() {
  const appId = String(process.env.WORLD_APP_ID || process.env.NEXT_PUBLIC_WORLD_APP_ID || "").trim();
  const apiKey = String(process.env.WORLD_APP_API_KEY || process.env.DEV_PORTAL_API_KEY || "").trim();

  if (!appId) {
    throw new Error("WORLD_APP_ID or NEXT_PUBLIC_WORLD_APP_ID is not configured.");
  }

  if (!apiKey) {
    throw new Error("WORLD_APP_API_KEY is not configured.");
  }

  return { appId, apiKey };
}

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
    const transactionId = String(context.params.transactionId || "").trim();
    if (!transactionId) {
      return NextResponse.json(
        {
          success: false,
          message: "transactionId is required.",
        },
        { status: 400 }
      );
    }

    const { appId, apiKey } = getWorldConfig();
    const response = await fetch(
      `https://developer.worldcoin.org/api/v2/minikit/transaction/${encodeURIComponent(
        transactionId
      )}?app_id=${encodeURIComponent(appId)}&type=transaction`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
      }
    );

    const payload = (await response.json()) as RawWorldTransaction & {
      success?: boolean;
      error?: string;
      message?: string;
    };

    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Failed to confirm World transaction.");
    }

    return NextResponse.json({
      success: true,
      data: {
        transactionId: payload.transactionId || payload.transaction_id || transactionId,
        transactionHash: payload.transactionHash || payload.transaction_hash || null,
        transactionStatus: normalizeStatus(payload.transactionStatus || payload.transaction_status),
        miniappId: payload.miniappId || payload.mini_app_id || null,
        updatedAt: payload.updatedAt || payload.updated_at || null,
        network: payload.network || payload.chain || null,
        fromWalletAddress: payload.fromWalletAddress || payload.from_wallet_address || null,
        toContractAddress: payload.toContractAddress || payload.to_contract_address || null,
        reference: payload.reference || null,
        timestamp: payload.timestamp || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm World transaction.";
    const status = /unauthorized/i.test(message) ? 401 : /not configured/i.test(message) ? 503 : 400;

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status }
    );
  }
}
