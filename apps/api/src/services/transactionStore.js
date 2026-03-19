const { mkdir, readFile, rename, writeFile } = require("fs/promises");
const path = require("path");
const { buildQuote } = require("./quoteService");
const { assertTransition, STATUSES } = require("./transactionStateMachine");
const { normalizeAddress } = require("./userStore");
const { mpesaConfig } = require("../config/mpesa");
const { calculateExpectedFundingFromQuote } = require("./mpesa/verifyUsdcFunding");

const FLOW_TYPES = ["onramp", "offramp", "paybill", "buygoods"];
const MPESA_INITIATION_FLOWS = new Set(["offramp", "paybill", "buygoods"]);
const FUNDED_FLOWS = new Set(["offramp", "paybill", "buygoods"]);

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

function normalizeTransactionId(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function normalizeQuoteId(value) {
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

function requiresOnchainFunding(flowType) {
  return FUNDED_FLOWS.has(flowType) && Boolean(mpesaConfig.settlement?.requireOnchainFunding);
}

function buildOnchainState(flowType, quote, existing = {}) {
  const required = requiresOnchainFunding(flowType);
  const existingTxHash = normalizeOptionalText(existing.txHash);
  const existingFundedAmountUnits = normalizeOptionalText(existing.fundedAmountUnits);
  const existingVerificationStatus = normalizeOptionalText(existing.verificationStatus);
  let expectedAmountUnits = normalizeOptionalText(existing.expectedAmountUnits);
  let expectedAmountUsd = Number(existing.expectedAmountUsd);

  if (!Number.isFinite(expectedAmountUsd) || expectedAmountUsd <= 0) {
    expectedAmountUsd = Number(quote?.amountUsd || 0);
  }

  if (required) {
    try {
      const funding = calculateExpectedFundingFromQuote(
        quote,
        mpesaConfig.treasury?.usdcDecimals || 6
      );
      expectedAmountUnits = expectedAmountUnits || funding.expectedUnitsString;
      expectedAmountUsd = funding.expectedUsd;
    } catch {
      expectedAmountUnits = expectedAmountUnits || null;
    }
  } else {
    const hasRecordedOnchainActivity = Boolean(existingTxHash || existingFundedAmountUnits);
    expectedAmountUnits = hasRecordedOnchainActivity ? expectedAmountUnits || null : null;
  }

  const fundedAmountUsd = Number(existing.fundedAmountUsd);

  return {
    txHash: existingTxHash,
    chainId: Number.isFinite(Number(existing.chainId)) ? Number(existing.chainId) : mpesaConfig.treasury?.chainId || null,
    required,
    verificationStatus:
      required
        ? existingVerificationStatus || "pending"
        : existingVerificationStatus || (existingTxHash ? "verified" : "not_required"),
    tokenAddress:
      normalizeOptionalText(existing.tokenAddress) ||
      normalizeOptionalText(mpesaConfig.treasury?.usdcContract),
    tokenSymbol: normalizeOptionalText(existing.tokenSymbol) || "USDC",
    treasuryAddress:
      normalizeOptionalText(existing.treasuryAddress) ||
      normalizeOptionalText(mpesaConfig.treasury?.address),
    expectedAmountUsd,
    expectedAmountUnits,
    fundedAmountUsd: Number.isFinite(fundedAmountUsd) ? fundedAmountUsd : 0,
    fundedAmountUnits: normalizeOptionalText(existing.fundedAmountUnits),
    fromAddress: normalizeOptionalText(existing.fromAddress),
    toAddress: normalizeOptionalText(existing.toAddress),
    logIndex: Number.isFinite(Number(existing.logIndex)) ? Number(existing.logIndex) : null,
    verifiedBy: normalizeOptionalText(existing.verifiedBy),
    verificationError: normalizeOptionalText(existing.verificationError),
    verifiedAt: normalizeOptionalText(existing.verifiedAt),
  };
}

function buildDarajaState(existing = {}) {
  return {
    merchantRequestId: normalizeOptionalText(existing.merchantRequestId),
    checkoutRequestId: normalizeOptionalText(existing.checkoutRequestId),
    conversationId: normalizeOptionalText(existing.conversationId),
    originatorConversationId: normalizeOptionalText(existing.originatorConversationId),
    responseCode: normalizeOptionalText(existing.responseCode),
    responseDescription: normalizeOptionalText(existing.responseDescription),
    resultCode: Number.isFinite(Number(existing.resultCode)) ? Number(existing.resultCode) : null,
    resultCodeRaw: normalizeOptionalText(existing.resultCodeRaw),
    resultDesc: normalizeOptionalText(existing.resultDesc),
    receiptNumber: normalizeOptionalText(existing.receiptNumber),
    customerMessage: normalizeOptionalText(existing.customerMessage),
    callbackReceivedAt: normalizeOptionalText(existing.callbackReceivedAt),
    rawRequest: existing.rawRequest || null,
    rawResponse: existing.rawResponse || null,
    rawCallback: existing.rawCallback || null,
  };
}

function buildRefundState(existing = {}) {
  return {
    status: normalizeOptionalText(existing.status) || "none",
    reason: normalizeOptionalText(existing.reason),
    txHash: normalizeOptionalText(existing.txHash),
    initiatedAt: normalizeOptionalText(existing.initiatedAt),
    completedAt: normalizeOptionalText(existing.completedAt),
  };
}

function ensureMetadataExtra(transaction) {
  transaction.metadata = transaction.metadata || {};
  transaction.metadata.source = normalizeOptionalText(transaction.metadata.source) || "miniapp";
  transaction.metadata.ipAddress = normalizeOptionalText(transaction.metadata.ipAddress);
  transaction.metadata.userAgent = normalizeOptionalText(transaction.metadata.userAgent);
  transaction.metadata.tags = Array.isArray(transaction.metadata.tags)
    ? transaction.metadata.tags.slice(0, 20)
    : [];

  const currentExtra = transaction.metadata.extra;
  if (!currentExtra || typeof currentExtra !== "object" || Array.isArray(currentExtra)) {
    transaction.metadata.extra = {};
  }

  return transaction.metadata.extra;
}

function hydrateStoredTransaction(transaction) {
  const flowType = normalizeFlowType(transaction.flowType);
  const next = {
    ...transaction,
    transactionId: normalizeTransactionId(transaction.transactionId),
    flowType,
    status: normalizeStatus(transaction.status),
    userAddress: normalizeAddress(transaction.userAddress),
    businessId: normalizeOptionalText(transaction.businessId),
    idempotencyKey: normalizeOptionalText(transaction.idempotencyKey),
    targets: {
      phoneNumber: normalizeOptionalText(transaction.targets?.phoneNumber),
      paybillNumber: normalizeOptionalText(transaction.targets?.paybillNumber),
      tillNumber: normalizeOptionalText(transaction.targets?.tillNumber),
      accountReference: normalizeOptionalText(transaction.targets?.accountReference),
    },
    authorization: {
      pinProvided: Boolean(transaction.authorization?.pinProvided),
      signature: normalizeOptionalText(transaction.authorization?.signature),
      signedAt: normalizeOptionalText(transaction.authorization?.signedAt),
      nonce: normalizeOptionalText(transaction.authorization?.nonce),
    },
    history: Array.isArray(transaction.history) ? transaction.history : [],
    createdAt: normalizeOptionalText(transaction.createdAt) || nowIso(),
    updatedAt: normalizeOptionalText(transaction.updatedAt) || normalizeOptionalText(transaction.createdAt) || nowIso(),
  };

  next.onchain = buildOnchainState(flowType, next.quote, transaction.onchain || {});
  next.daraja = buildDarajaState(transaction.daraja || {});
  next.refund = buildRefundState(transaction.refund || {});
  ensureMetadataExtra(next);

  return next;
}

async function readTransactions(filePath = getTransactionStoreFilePath()) {
  const resolved = await ensureTransactionStore(filePath);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw || "[]");
  if (!Array.isArray(parsed)) return [];
  return parsed.map(hydrateStoredTransaction);
}

async function writeTransactions(transactions, filePath = getTransactionStoreFilePath()) {
  const resolved = await ensureTransactionStore(filePath);
  const tempPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(transactions, null, 2)}\n`, "utf8");
  await rename(tempPath, resolved);
}

function applyFundingDefaults(transaction) {
  transaction.onchain = buildOnchainState(transaction.flowType, transaction.quote, transaction.onchain || {});
  return transaction.onchain;
}

function toPublicTransaction(transaction) {
  const hydrated = hydrateStoredTransaction(transaction);
  return {
    transactionId: hydrated.transactionId,
    flowType: hydrated.flowType,
    status: hydrated.status,
    userAddress: hydrated.userAddress,
    businessId: hydrated.businessId,
    idempotencyKey: hydrated.idempotencyKey,
    quote: hydrated.quote,
    targets: hydrated.targets,
    authorization: hydrated.authorization,
    onchain: hydrated.onchain,
    daraja: {
      merchantRequestId: hydrated.daraja.merchantRequestId,
      checkoutRequestId: hydrated.daraja.checkoutRequestId,
      conversationId: hydrated.daraja.conversationId,
      originatorConversationId: hydrated.daraja.originatorConversationId,
      responseCode: hydrated.daraja.responseCode,
      responseDescription: hydrated.daraja.responseDescription,
      resultCode: hydrated.daraja.resultCode,
      resultCodeRaw: hydrated.daraja.resultCodeRaw,
      resultDesc: hydrated.daraja.resultDesc,
      receiptNumber: hydrated.daraja.receiptNumber,
      customerMessage: hydrated.daraja.customerMessage,
      callbackReceivedAt: hydrated.daraja.callbackReceivedAt,
    },
    refund: hydrated.refund,
    history: hydrated.history || [],
    metadata: hydrated.metadata,
    createdAt: hydrated.createdAt,
    updatedAt: hydrated.updatedAt,
  };
}

function matchesTransactionLookup(entry, lookup = {}) {
  if (lookup.transactionId) {
    if (entry.transactionId !== normalizeTransactionId(lookup.transactionId)) return false;
  }
  if (lookup.quoteId) {
    if (entry.quote?.quoteId !== normalizeQuoteId(lookup.quoteId)) return false;
  }
  if (lookup.userAddress) {
    if (entry.userAddress !== normalizeAddress(lookup.userAddress)) return false;
  }
  if (lookup.flowType) {
    if (entry.flowType !== normalizeFlowType(lookup.flowType)) return false;
  }
  if (lookup.idempotencyKey) {
    if (entry.idempotencyKey !== normalizeOptionalText(lookup.idempotencyKey)) return false;
  }

  return true;
}

async function findTransactionContext(lookup = {}, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  const index = transactions.findIndex((entry) => matchesTransactionLookup(entry, lookup));

  if (index === -1) return null;

  return {
    filePath,
    index,
    transaction: transactions[index],
    transactions,
  };
}

async function findTransactionContextByWebhookRefs(lookup = {}, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  const transactions = await readTransactions(filePath);
  const normalizedTxId = normalizeTransactionId(lookup.transactionId);

  if (normalizedTxId) {
    const directIndex = transactions.findIndex((entry) => entry.transactionId === normalizedTxId);
    if (directIndex !== -1) {
      return {
        filePath,
        index: directIndex,
        transaction: transactions[directIndex],
        transactions,
      };
    }
  }

  const refs = [
    normalizeOptionalText(lookup.checkoutRequestId),
    normalizeOptionalText(lookup.merchantRequestId),
    normalizeOptionalText(lookup.conversationId),
    normalizeOptionalText(lookup.originatorConversationId),
  ].filter(Boolean);

  if (refs.length === 0) return null;

  const index = transactions.findIndex((entry) => {
    const daraja = entry.daraja || {};
    return refs.includes(daraja.checkoutRequestId) ||
      refs.includes(daraja.merchantRequestId) ||
      refs.includes(daraja.conversationId) ||
      refs.includes(daraja.originatorConversationId);
  });

  if (index === -1) return null;

  return {
    filePath,
    index,
    transaction: transactions[index],
    transactions,
  };
}

async function saveTransactionContext(context) {
  context.transaction = hydrateStoredTransaction(context.transaction);
  context.transaction.updatedAt = nowIso();
  context.transactions[context.index] = context.transaction;
  await writeTransactions(context.transactions, context.filePath);
  return toPublicTransaction(context.transaction);
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
  const transaction = hydrateStoredTransaction({
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
    onchain: buildOnchainState(flowType, quote),
    daraja: buildDarajaState(),
    refund: buildRefundState(),
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
      extra: input.metadata?.extra || {},
    },
    createdAt: now,
    updatedAt: now,
  });

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
  const context = await findTransactionContext({ transactionId }, options);
  return context ? toPublicTransaction(context.transaction) : null;
}

async function listTransactions(filters = {}, options = {}) {
  const filePath = options.filePath || getTransactionStoreFilePath();
  let results = await readTransactions(filePath);

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
  const context = await findTransactionContext({ transactionId }, options);
  if (!context) {
    const error = new Error("Transaction not found.");
    error.statusCode = 404;
    throw error;
  }

  assertTransition(context.transaction, normalizeStatus(to), reason, source);
  return saveTransactionContext(context);
}

module.exports = {
  FLOW_TYPES,
  MPESA_INITIATION_FLOWS,
  STATUSES,
  applyFundingDefaults,
  createQuotedTransaction,
  ensureMetadataExtra,
  findTransactionContext,
  findTransactionContextByWebhookRefs,
  getTransactionById,
  getTransactionStoreFilePath,
  listTransactions,
  nowIso,
  readTransactions,
  requiresOnchainFunding,
  saveTransactionContext,
  toPublicTransaction,
  transitionTransaction,
  writeTransactions,
};
