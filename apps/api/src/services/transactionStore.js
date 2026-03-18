const { mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { buildQuote } = require("./quoteService");
const { assertTransition, STATUSES } = require("./transactionStateMachine");
const { normalizeAddress } = require("./userStore");

const FLOW_TYPES = ["onramp", "offramp", "paybill", "buygoods"];

function getTransactionStoreFilePath() {
  if (process.env.TRANSACTION_STORE_FILE) {
    return path.resolve(process.env.TRANSACTION_STORE_FILE);
  }

  return path.join(__dirname, "..", "data", "transactions.json");
}

async function ensureTransactionStore(filePath = getTransactionStoreFilePath()) {
  await mkdir(path.dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "[]\n", "utf8");
  }

  return filePath;
}

async function readTransactions(filePath = getTransactionStoreFilePath()) {
  const resolved = await ensureTransactionStore(filePath);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function writeTransactions(transactions, filePath = getTransactionStoreFilePath()) {
  const resolved = await ensureTransactionStore(filePath);
  const tempPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(transactions, null, 2)}\n`, "utf8");
  await rename(tempPath, resolved);
}

function generateTransactionId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MPX${Date.now().toString(36).toUpperCase()}${rand}`;
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeFlowType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!FLOW_TYPES.includes(normalized)) {
    throw new Error("flowType must be one of onramp, offramp, paybill, or buygoods.");
  }
  return normalized;
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim();
  if (!STATUSES.includes(normalized)) {
    throw new Error("status is invalid.");
  }
  return normalized;
}

function normalizeTargets(flowType, input) {
  const phoneNumber = normalizeOptionalText(input.phoneNumber);
  const paybillNumber = normalizeOptionalText(input.paybillNumber);
  const tillNumber = normalizeOptionalText(input.tillNumber);
  const accountReference = normalizeOptionalText(input.accountReference);

  if ((flowType === "onramp" || flowType === "offramp") && !phoneNumber) {
    throw new Error("phoneNumber is required for onramp and offramp flows.");
  }
  if (flowType === "paybill") {
    if (!phoneNumber) throw new Error("phoneNumber is required for paybill.");
    if (!paybillNumber) throw new Error("paybillNumber is required for paybill.");
    if (!accountReference) throw new Error("accountReference is required for paybill.");
  }
  if (flowType === "buygoods" && !tillNumber) {
    throw new Error("tillNumber is required for buygoods.");
  }

  return {
    phoneNumber,
    paybillNumber,
    tillNumber,
    accountReference,
  };
}

function toPublicTransaction(transaction) {
  return {
    transactionId: transaction.transactionId,
    flowType: transaction.flowType,
    status: transaction.status,
    userAddress: transaction.userAddress,
    businessId: transaction.businessId,
    idempotencyKey: transaction.idempotencyKey,
    quote: transaction.quote,
    targets: transaction.targets,
    authorization: transaction.authorization,
    onchain: transaction.onchain,
    daraja: transaction.daraja,
    refund: transaction.refund,
    history: transaction.history || [],
    metadata: transaction.metadata,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

async function createQuotedTransaction(input, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  const flowType = normalizeFlowType(input.flowType);
  const userAddress = normalizeAddress(input.userAddress);
  const idempotencyKey = normalizeOptionalText(input.idempotencyKey);

  if (idempotencyKey) {
    const existing = transactions.find(
      (transaction) =>
        transaction.userAddress === userAddress &&
        transaction.flowType === flowType &&
        transaction.idempotencyKey === idempotencyKey
    );

    if (existing) {
      return {
        transaction: toPublicTransaction(existing),
        quote: existing.quote,
        idempotent: true,
      };
    }
  }

  const quote = buildQuote({
    flowType,
    amount: input.amount,
    currency: input.currency,
    kesPerUsd: input.kesPerUsd,
  });
  const now = new Date().toISOString();
  const transaction = {
    transactionId: generateTransactionId(),
    flowType,
    status: "created",
    userAddress,
    businessId: normalizeOptionalText(input.businessId),
    idempotencyKey,
    quote,
    targets: normalizeTargets(flowType, input),
    authorization: {
      pinProvided: false,
      signature: null,
      signedAt: null,
      nonce: null,
    },
    onchain: {
      txHash: null,
      chainId: null,
      required: flowType !== "onramp",
      verificationStatus: flowType === "onramp" ? "not_required" : "pending",
      tokenAddress: null,
      tokenSymbol: "USDC",
      treasuryAddress: null,
      expectedAmountUsd: quote.amountUsd,
      expectedAmountUnits: null,
      fundedAmountUsd: 0,
      fundedAmountUnits: null,
      fromAddress: null,
      toAddress: null,
      logIndex: null,
      verifiedBy: null,
      verificationError: null,
      verifiedAt: null,
    },
    daraja: {
      merchantRequestId: null,
      checkoutRequestId: null,
      conversationId: null,
      originatorConversationId: null,
      responseCode: null,
      responseDescription: null,
      resultCode: null,
      resultCodeRaw: null,
      resultDesc: null,
      receiptNumber: null,
      customerMessage: null,
      callbackReceivedAt: null,
    },
    refund: {
      status: "none",
      reason: null,
      txHash: null,
      initiatedAt: null,
      completedAt: null,
    },
    history: [
      {
        from: null,
        to: "created",
        reason: "Transaction intent created.",
        source: "system",
        at: now,
      },
    ],
    metadata: {
      source: normalizeOptionalText(input.metadata?.source) || "miniapp",
      ipAddress: normalizeOptionalText(input.metadata?.ipAddress),
      userAgent: normalizeOptionalText(input.metadata?.userAgent),
      tags: Array.isArray(input.metadata?.tags) ? input.metadata.tags.slice(0, 10) : [],
      extra: input.metadata?.extra || null,
    },
    createdAt: now,
    updatedAt: now,
  };

  assertTransition(transaction, "quoted", "Quote created.", "quote-service");
  transaction.updatedAt = new Date().toISOString();

  transactions.push(transaction);
  await writeTransactions(transactions, filePath);

  return {
    transaction: toPublicTransaction(transaction),
    quote: transaction.quote,
    idempotent: false,
  };
}

async function getTransactionById(transactionId, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  const normalized = String(transactionId || "").trim().toUpperCase();
  const transaction = transactions.find((entry) => entry.transactionId === normalized);
  return transaction ? toPublicTransaction(transaction) : null;
}

async function listTransactions(filters = {}, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  let results = [...transactions];

  if (filters.userAddress) {
    results = results.filter((entry) => entry.userAddress === normalizeAddress(filters.userAddress));
  }
  if (filters.flowType) {
    results = results.filter((entry) => entry.flowType === normalizeFlowType(filters.flowType));
  }
  if (filters.status) {
    results = results.filter((entry) => entry.status === normalizeStatus(filters.status));
  }

  const limit = Number.isFinite(Number(filters.limit)) ? Math.max(1, Math.min(50, Number(filters.limit))) : 20;
  return results
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit)
    .map(toPublicTransaction);
}

async function transitionTransaction(transactionId, to, reason, source = "system", options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  const normalizedId = String(transactionId || "").trim().toUpperCase();
  const index = transactions.findIndex((entry) => entry.transactionId === normalizedId);

  if (index === -1) {
    const error = new Error("Transaction not found.");
    error.statusCode = 404;
    throw error;
  }

  const transaction = transactions[index];
  assertTransition(transaction, normalizeStatus(to), reason, source);
  transaction.updatedAt = new Date().toISOString();

  transactions[index] = transaction;
  await writeTransactions(transactions, filePath);
  return toPublicTransaction(transaction);
}

module.exports = {
  FLOW_TYPES,
  STATUSES,
  createQuotedTransaction,
  getTransactionById,
  getTransactionStoreFilePath,
  listTransactions,
  toPublicTransaction,
  transitionTransaction,
};
