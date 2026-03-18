const { mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { buildQuote, isQuoteExpired } = require("./quoteService");
const { assertTransition, STATUSES } = require("./transactionStateMachine");
const { normalizeAddress, verifyUserPinForAddress } = require("./userStore");

const FLOW_TYPES = ["onramp", "offramp", "paybill", "buygoods"];
const MPESA_INITIATION_FLOWS = new Set(["offramp", "paybill", "buygoods"]);

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

function nowIso() {
  return new Date().toISOString();
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

function getSimulationConfig(options = {}) {
  const enabled =
    options.simulationEnabled !== undefined
      ? Boolean(options.simulationEnabled)
      : String(process.env.MPESA_SIMULATION_MODE || "true").trim().toLowerCase() !== "false";

  const delayRaw =
    options.simulationDelayMs !== undefined
      ? Number(options.simulationDelayMs)
      : Number(process.env.MPESA_SIMULATION_DELAY_MS || 2500);

  return {
    enabled,
    delayMs: Number.isFinite(delayRaw) ? Math.max(0, delayRaw) : 2500,
  };
}

function createSimulationDetails(transaction) {
  const seed = transaction.transactionId.slice(-8);
  return {
    merchantRequestId: `MR${seed}`,
    checkoutRequestId: transaction.flowType === "offramp" ? null : `CR${seed}`,
    conversationId: `CV${seed}`,
    originatorConversationId: `OC${seed}`,
    responseCode: "0",
    responseDescription: "Accepted for simulated processing.",
    resultCode: null,
    resultCodeRaw: null,
    resultDesc: null,
    receiptNumber: null,
    customerMessage: "Request accepted for processing.",
    callbackReceivedAt: null,
  };
}

function ensureMetadata(transaction) {
  transaction.metadata = transaction.metadata || {};
  transaction.metadata.extra = transaction.metadata.extra || {};
  return transaction.metadata.extra;
}

function finalizeSimulatedSuccess(transaction) {
  if (transaction.status !== "mpesa_processing") return false;

  const extra = ensureMetadata(transaction);
  const simulation = extra.mpesaSimulation;
  if (!simulation || !simulation.resolveAt) return false;
  if (new Date(simulation.resolveAt).getTime() > Date.now()) return false;

  assertTransition(transaction, "succeeded", "Simulated M-Pesa callback received.", "simulation");
  transaction.updatedAt = nowIso();
  transaction.daraja = {
    ...transaction.daraja,
    resultCode: 0,
    resultCodeRaw: "0",
    resultDesc: "The service request is processed successfully.",
    receiptNumber: `RCP${transaction.transactionId.slice(-8)}`,
    customerMessage: "Simulated M-Pesa payout completed.",
    callbackReceivedAt: nowIso(),
  };
  extra.mpesaSimulation = {
    ...simulation,
    finalizedAt: transaction.updatedAt,
    finalStatus: "succeeded",
  };
  return true;
}

async function hydrateSimulatedTransactions(transactions, filePath, options = {}) {
  let changed = false;
  for (const transaction of transactions) {
    if (finalizeSimulatedSuccess(transaction)) {
      changed = true;
    }
  }

  if (changed) {
    await writeTransactions(transactions, filePath || getTransactionStoreFilePath());
  }

  return transactions;
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

  const now = nowIso();
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
  transaction.updatedAt = nowIso();

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
  await hydrateSimulatedTransactions(transactions, filePath, options);
  const normalized = String(transactionId || "").trim().toUpperCase();
  const transaction = transactions.find((entry) => entry.transactionId === normalized);
  return transaction ? toPublicTransaction(transaction) : null;
}

async function listTransactions(filters = {}, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  await hydrateSimulatedTransactions(transactions, filePath, options);
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
  transaction.updatedAt = nowIso();

  transactions[index] = transaction;
  await writeTransactions(transactions, filePath);
  return toPublicTransaction(transaction);
}

async function initiateMpesaTransaction(input, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  await hydrateSimulatedTransactions(transactions, filePath, options);

  const transactionId = String(input.transactionId || "").trim().toUpperCase();
  const userAddress = normalizeAddress(input.userAddress);
  const flowType = normalizeFlowType(input.flowType);
  const pin = String(input.pin || "").trim();
  const signature = normalizeOptionalText(input.signature);
  const nonce = normalizeOptionalText(input.nonce);
  const signedAt = normalizeOptionalText(input.signedAt) || nowIso();

  if (!MPESA_INITIATION_FLOWS.has(flowType)) {
    throw new Error("Only cashout, paybill, and till initiation are supported in this slice.");
  }

  const index = transactions.findIndex((entry) => entry.transactionId === transactionId);
  if (index === -1) {
    const error = new Error("Transaction not found.");
    error.statusCode = 404;
    throw error;
  }

  const transaction = transactions[index];
  if (transaction.userAddress !== userAddress) {
    const error = new Error("Unauthorized.");
    error.statusCode = 401;
    throw error;
  }
  if (transaction.flowType !== flowType) {
    throw new Error("Transaction flow does not match the initiation route.");
  }
  if (isQuoteExpired(transaction.quote)) {
    throw new Error("Quote has expired. Please generate a new quote.");
  }
  if (transaction.status === "succeeded") {
    return toPublicTransaction(transaction);
  }
  if (transaction.status === "mpesa_processing" || transaction.status === "mpesa_submitted") {
    return toPublicTransaction(transaction);
  }

  const verified = await verifyUserPinForAddress(userAddress, pin, {
    filePath: options.userStoreFilePath,
  });
  if (!verified) {
    const error = new Error("Invalid PIN.");
    error.statusCode = 401;
    throw error;
  }

  transaction.authorization = {
    pinProvided: true,
    signature,
    signedAt,
    nonce,
  };

  if (transaction.status === "quoted") {
    assertTransition(transaction, "awaiting_user_authorization", "User approved request with PIN.", "api");
  }

  if (transaction.onchain?.required && transaction.status === "awaiting_user_authorization") {
    assertTransition(transaction, "awaiting_onchain_funding", "Waiting for on-chain funding.", "api");
  }

  if (transaction.status === "awaiting_onchain_funding") {
    transaction.onchain = {
      ...transaction.onchain,
      verificationStatus: "verified",
      fundedAmountUsd: transaction.onchain.expectedAmountUsd,
      verifiedAt: nowIso(),
      verifiedBy: "simulation",
      verificationError: null,
    };
    assertTransition(transaction, "mpesa_submitted", "Simulated funding verified and request submitted.", "simulation");
  } else if (transaction.status === "awaiting_user_authorization") {
    assertTransition(transaction, "mpesa_submitted", "Request submitted.", "api");
  }

  if (transaction.status === "mpesa_submitted") {
    assertTransition(transaction, "mpesa_processing", "Awaiting M-Pesa callback.", "api");
  }

  transaction.daraja = createSimulationDetails(transaction);
  const simulation = getSimulationConfig(options);
  const extra = ensureMetadata(transaction);
  extra.mpesaSimulation = {
    enabled: simulation.enabled,
    resolveAt: new Date(Date.now() + simulation.delayMs).toISOString(),
    finalStatus: "succeeded",
    initiatedAt: nowIso(),
  };
  transaction.updatedAt = nowIso();

  transactions[index] = transaction;
  await writeTransactions(transactions, filePath);
  return toPublicTransaction(transaction);
}

module.exports = {
  FLOW_TYPES,
  MPESA_INITIATION_FLOWS,
  STATUSES,
  createQuotedTransaction,
  getTransactionById,
  getTransactionStoreFilePath,
  initiateMpesaTransaction,
  listTransactions,
  toPublicTransaction,
  transitionTransaction,
};
