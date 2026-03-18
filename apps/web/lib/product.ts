export type FlowStatus = "live" | "building" | "blocked";

export type ProfileStatus = "needs_profile" | "needs_pin" | "active";

export type TransactionFlowType = "onramp" | "offramp" | "paybill" | "buygoods";

export type TransactionStatus =
  | "created"
  | "quoted"
  | "awaiting_user_authorization"
  | "awaiting_onchain_funding"
  | "mpesa_submitted"
  | "mpesa_processing"
  | "succeeded"
  | "failed"
  | "refund_pending"
  | "refunded";

export type TransactionQuote = {
  quoteId: string;
  currency: "KES" | "USD";
  amountRequested: number;
  amountKes: number;
  amountUsd: number;
  rateKesPerUsd: number;
  feeAmountKes: number;
  networkFeeKes: number;
  totalDebitKes: number;
  expectedReceiveKes: number;
  expiresAt: string;
  snapshotAt: string;
};

export type TransactionTargets = {
  phoneNumber: string | null;
  paybillNumber: string | null;
  tillNumber: string | null;
  accountReference: string | null;
};

export type TransactionIntent = {
  transactionId: string;
  flowType: TransactionFlowType;
  status: TransactionStatus;
  userAddress: string;
  businessId: string | null;
  idempotencyKey: string | null;
  quote: TransactionQuote;
  targets: TransactionTargets;
  authorization: {
    pinProvided: boolean;
    signature: string | null;
    signedAt: string | null;
    nonce: string | null;
  };
  onchain: {
    txHash: string | null;
    chainId: number | null;
    required: boolean;
    verificationStatus: "not_required" | "pending" | "verified" | "failed";
    tokenAddress: string | null;
    tokenSymbol: string | null;
    treasuryAddress: string | null;
    expectedAmountUsd: number;
    expectedAmountUnits: string | null;
    fundedAmountUsd: number;
    fundedAmountUnits: string | null;
    fromAddress: string | null;
    toAddress: string | null;
    logIndex: number | null;
    verifiedBy: string | null;
    verificationError: string | null;
    verifiedAt: string | null;
  };
  daraja: {
    merchantRequestId: string | null;
    checkoutRequestId: string | null;
    conversationId: string | null;
    originatorConversationId: string | null;
    responseCode: string | null;
    responseDescription: string | null;
    resultCode: number | null;
    resultCodeRaw: string | null;
    resultDesc: string | null;
    receiptNumber: string | null;
    customerMessage: string | null;
    callbackReceivedAt: string | null;
  };
  refund: {
    status: "none" | "pending" | "completed" | "failed";
    reason: string | null;
    txHash: string | null;
    initiatedAt: string | null;
    completedAt: string | null;
  };
  history: Array<{
    from: TransactionStatus | null;
    to: TransactionStatus;
    reason: string | null;
    source: string;
    at: string;
  }>;
  metadata: {
    source: string;
    ipAddress: string | null;
    userAgent: string | null;
    tags: string[];
    extra: unknown;
  };
  createdAt: string;
  updatedAt: string;
};

export type BackendUserProfile = {
  id: string;
  address: string;
  dotpayId: string;
  authMethod: string;
  username: string | null;
  worldUsername: string | null;
  worldUsernameVerified: boolean;
  profilePictureUrl: string | null;
  pinSet: boolean;
  pinUpdatedAt: string | null;
  profileStatus: ProfileStatus;
  profileCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type FlowCard = {
  href: string;
  label: string;
  icon: string;
  title: string;
  description: string;
  status: FlowStatus;
};

export type Milestone = {
  name: string;
  detail: string;
  status: FlowStatus;
};

export type ProductSession = {
  walletAddress: string;
  username: string | null;
  profilePictureUrl: string | null;
  loggedInAt: string;
  userProfile: BackendUserProfile | null;
};

export type QuoteResult = {
  transaction: TransactionIntent;
  quote: TransactionQuote;
  idempotent: boolean;
};

export const flowCards: FlowCard[] = [
  {
    href: "/send",
    label: "Send",
    icon: "↑",
    title: "Send and cash out",
    description: "Port wallet transfers and M-Pesa cashout into a World-native flow.",
    status: "building",
  },
  {
    href: "/pay",
    label: "Pay",
    icon: "◎",
    title: "Pay merchants",
    description: "Support PayBill and till flows while verifying every payment server-side.",
    status: "building",
  },
  {
    href: "/add-funds",
    label: "Funds",
    icon: "+",
    title: "Add funds",
    description: "Keep the existing M-Pesa onramp logic and adapt settlement for World wallets.",
    status: "building",
  },
  {
    href: "/activity",
    label: "Activity",
    icon: "≣",
    title: "Receipts and history",
    description: "Bring over timelines, receipts, and transaction state tracking from DotPay.",
    status: "building",
  },
];

export const phaseMilestones: Milestone[] = [
  {
    name: "Wallet Auth",
    detail: "World Mini App sign-in with nonce issuance and SIWE verification.",
    status: "live",
  },
  {
    name: "Profile setup",
    detail: "Backend-backed username, PIN, and onboarding state are now wired into the mini app.",
    status: "live",
  },
  {
    name: "Product parity map",
    detail: "Current DotPay flows mapped into the new mini app roadmap.",
    status: "live",
  },
  {
    name: "M-Pesa state machine",
    detail: "Next port from DotPayBE into the new API service.",
    status: "building",
  },
  {
    name: "In-app payment QA",
    detail: "Blocked on mainnet-only World Mini App transaction testing rules.",
    status: "blocked",
  },
];

export const pageContent = {
  send: {
    eyebrow: "Flow Port",
    title: "Send",
    subtitle:
      "This slice will keep the existing recipient, amount, review, and receipt stages while replacing direct wallet connection with World-native wallet rails.",
    checklist: [
      "Port direct wallet transfer parity",
      "Port M-Pesa cashout quote and receipt flow",
      "Swap thirdweb auth for World Wallet Auth session",
    ],
  },
  pay: {
    eyebrow: "Merchant Flow",
    title: "Pay",
    subtitle:
      "PayBill and Till still belong to the backend settlement engine. The World Mini App will handle customer authorization and payment initiation.",
    checklist: [
      "Port PayBill and Buy Goods UI",
      "Store payment intent in backend before command execution",
      "Verify World pay results before marking merchant settlement progress",
    ],
  },
  addFunds: {
    eyebrow: "Onramp Flow",
    title: "Add Funds",
    subtitle:
      "The current STK push flow remains valid as a backend orchestration pattern. The wallet settlement leg will be adapted for the World wallet.",
    checklist: [
      "Port STK push initiation screen",
      "Track callback and treasury payout state",
      "Show final receipt inside the mini app",
    ],
  },
  activity: {
    eyebrow: "System Of Record",
    title: "Activity",
    subtitle:
      "Receipts, timelines, and transaction history should stay conceptually close to DotPayBE so support and reconciliation still work.",
    checklist: [
      "Mirror the current transaction state machine",
      "Port receipt and callback metadata views",
      "Surface failures and refunds clearly",
    ],
  },
  settings: {
    eyebrow: "Identity",
    title: "Settings",
    subtitle:
      "World usernames become the first-class identity surface, while profile, PIN, and notification settings remain product-level state in our backend.",
    checklist: [
      "Persist World username with DotPaymini profile",
      "Port PIN and notification preferences",
      "Prepare Developer Portal notification setup",
    ],
  },
} as const;
