const { mpesaConfig } = require("../config/mpesa");
const {
  applyFundingDefaults,
  ensureMetadataExtra,
  findTransactionContext,
  findTransactionContextByWebhookRefs,
  MPESA_INITIATION_FLOWS,
  nowIso,
  saveTransactionContext,
  toPublicTransaction,
} = require("./transactionStore");
const { assertTransition } = require("./transactionStateMachine");
const { normalizeAddress, verifyUserPinForAddress } = require("./userStore");
const { initiateB2B, initiateB2C, initiateStkPush } = require("./mpesa/darajaClient");
const { verifyUsdcFunding } = require("./mpesa/verifyUsdcFunding");
const { isQuoteExpired } = require("./quoteService");
const { hasTreasuryTransferConfig, settleOnrampToUserWallet } = require("./settlement/treasurySettlement");

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeOptionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizePhone(value) {
  return String(value || "").trim().replace(/[\s()+-]/g, "");
}

function normalizeNumber(value) {
  return String(value || "").trim();
}

function parseOptionalPositiveInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function isValidPhone(phone) {
  return /^254\d{9}$/.test(phone);
}

function ensureMpesaEnabled() {
  if (!mpesaConfig.enabled) {
    throw createHttpError("M-Pesa is currently disabled.", 503);
  }
}

function ensureSensitiveAuth(input) {
  const expectedLength = Math.max(4, Number(mpesaConfig.security?.pinMinLength || 6));
  const pin = String(input?.pin || "").trim();

  if (!pin || pin.length !== expectedLength || !/^\d+$/.test(pin)) {
    throw createHttpError(`pin is required and must be exactly ${expectedLength} digits.`);
  }

  const signature = String(input?.signature || "").trim();
  if (!signature) {
    return {
      nonce: null,
      pin,
      signature: null,
      signedAt: null,
      signedAtRaw: null,
    };
  }

  if (!/^0x[0-9a-fA-F]{130,}$/.test(signature)) {
    throw createHttpError("signature must be a 0x-prefixed hex string when provided.");
  }

  const nonce = String(input?.nonce || "").trim();
  if (!nonce || nonce.length < 8) {
    throw createHttpError("nonce is required and must be at least 8 characters when signature is provided.");
  }

  const signedAt = input?.signedAt ? new Date(input.signedAt) : new Date();
  const signedAtRaw = String(input?.signedAt || signedAt.toISOString()).trim();
  if (Number.isNaN(signedAt.getTime())) {
    throw createHttpError("signedAt must be a valid ISO date.");
  }

  const now = Date.now();
  const maxAgeMs = Math.max(30, Number(mpesaConfig.security?.signatureMaxAgeSeconds || 600)) * 1000;
  if (signedAt.getTime() > now + 60_000) {
    throw createHttpError("signedAt cannot be in the future.");
  }
  if (now - signedAt.getTime() > maxAgeMs) {
    throw createHttpError("signature has expired. Please sign and retry.");
  }

  return {
    nonce,
    pin,
    signature,
    signedAt,
    signedAtRaw,
  };
}

function buildCallbackUrl(kind, transactionId) {
  const pathByKind = {
    b2b_result: "/api/mpesa/webhooks/b2b/result",
    b2b_timeout: "/api/mpesa/webhooks/b2b/timeout",
    b2c_result: "/api/mpesa/webhooks/b2c/result",
    b2c_timeout: "/api/mpesa/webhooks/b2c/timeout",
    stk: "/api/mpesa/webhooks/stk",
  };

  const path = pathByKind[kind];
  if (!path) {
    throw createHttpError("Unsupported callback kind.", 500);
  }

  const baseUrl = kind.endsWith("timeout")
    ? mpesaConfig.callbacks.timeoutBaseUrl
    : mpesaConfig.callbacks.resultBaseUrl;

  if (!baseUrl) {
    throw createHttpError("M-Pesa callback base URL is not configured.", 500);
  }

  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("tx", transactionId);

  const webhookSecret = String(mpesaConfig.callbacks.webhookSecret || "").trim();
  if (webhookSecret) {
    url.searchParams.set("secret", webhookSecret);
  }

  return url.toString();
}

function resolveTargets(flowType, transaction, input) {
  const current = transaction.targets || {};

  if (flowType === "offramp") {
    const phoneNumber = normalizePhone(input.phoneNumber || current.phoneNumber || "");
    if (!isValidPhone(phoneNumber)) {
      throw createHttpError("phoneNumber must be in 2547XXXXXXXX format.");
    }
    return {
      ...current,
      phoneNumber,
    };
  }

  if (flowType === "paybill") {
    const phoneNumberRaw = normalizePhone(input.phoneNumber || current.phoneNumber || "");
    const paybillNumber = normalizeNumber(input.paybillNumber || current.paybillNumber || "");
    const accountReference = normalizeNumber(input.accountReference || current.accountReference || "");

    if (phoneNumberRaw && !isValidPhone(phoneNumberRaw)) {
      throw createHttpError("phoneNumber must be in 2547XXXXXXXX format when provided.");
    }
    if (!/^\d{5,8}$/.test(paybillNumber)) {
      throw createHttpError("paybillNumber must be 5-8 digits.");
    }
    if (!accountReference || accountReference.length < 2 || accountReference.length > 20) {
      throw createHttpError("accountReference must be 2-20 characters.");
    }

    return {
      ...current,
      accountReference,
      paybillNumber,
      phoneNumber: phoneNumberRaw || null,
    };
  }

  if (flowType === "buygoods") {
    const tillNumber = normalizeNumber(input.tillNumber || current.tillNumber || "");
    const accountReference = normalizeNumber(input.accountReference || current.accountReference || "DotPay");

    if (!/^\d{5,8}$/.test(tillNumber)) {
      throw createHttpError("tillNumber must be 5-8 digits.");
    }

    return {
      ...current,
      accountReference: accountReference || "DotPay",
      tillNumber,
    };
  }

  throw createHttpError("Unsupported M-Pesa flow.", 400);
}

async function verifyFundingIfRequired(transaction, userAddress, input, options = {}) {
  applyFundingDefaults(transaction);

  if (!transaction.onchain?.required) {
    transaction.onchain = {
      ...transaction.onchain,
      verificationError: null,
      verificationStatus: "not_required",
      verifiedAt: transaction.onchain?.verifiedAt || null,
      verifiedBy: transaction.onchain?.verifiedBy || null,
    };
    return;
  }

  const onchainTxHash = normalizeOptionalText(input.onchainTxHash);
  const chainId = parseOptionalPositiveInt(input.chainId);
  const expectedUnits = BigInt(String(transaction.onchain?.expectedAmountUnits || "0"));

  if (!onchainTxHash) {
    const error = createHttpError("onchainTxHash is required before M-Pesa submission.");
    transaction.onchain = {
      ...transaction.onchain,
      chainId: chainId || transaction.onchain?.chainId || null,
      txHash: null,
      verificationError: error.message,
      verificationStatus: "failed",
      verifiedAt: nowIso(),
      verifiedBy: "api",
    };
    error.persistTransaction = true;
    throw error;
  }

  if (expectedUnits <= 0n) {
    const error = createHttpError("Funding requirement is missing for this transaction.", 500);
    transaction.onchain = {
      ...transaction.onchain,
      chainId: chainId || transaction.onchain?.chainId || null,
      txHash: onchainTxHash,
      verificationError: error.message,
      verificationStatus: "failed",
      verifiedAt: nowIso(),
      verifiedBy: "api",
    };
    error.persistTransaction = true;
    throw error;
  }

  try {
    const fundingVerifier = options.fundingVerifier || verifyUsdcFunding;
    const verified = await fundingVerifier({
      txHash: onchainTxHash,
      expectedFromAddress: userAddress,
      providedChainId: chainId,
      expectedMinAmountUnits: expectedUnits,
    });

    transaction.onchain = {
      ...transaction.onchain,
      chainId: verified.chainId,
      fromAddress: verified.fromAddress,
      fundedAmountUnits: verified.fundedAmountUnits,
      fundedAmountUsd: verified.fundedAmountUsd,
      logIndex: Number.isFinite(verified.logIndex) ? verified.logIndex : null,
      toAddress: verified.toAddress,
      tokenAddress: verified.tokenAddress,
      treasuryAddress: verified.treasuryAddress,
      txHash: verified.txHash,
      verificationError: null,
      verificationStatus: "verified",
      verifiedAt: nowIso(),
      verifiedBy: "api",
    };
  } catch (error) {
    transaction.onchain = {
      ...transaction.onchain,
      chainId: chainId || transaction.onchain?.chainId || null,
      txHash: onchainTxHash,
      verificationError: error.message,
      verificationStatus: "failed",
      verifiedAt: nowIso(),
      verifiedBy: "api",
    };
    error.statusCode = error.statusCode || 400;
    error.persistTransaction = true;
    throw error;
  }
}

function updateAuthorizationMetadata(transaction, auth) {
  transaction.authorization = {
    pinProvided: true,
    signature: auth.signature || null,
    signedAt: auth.signedAtRaw || null,
    nonce: auth.nonce || null,
  };

  const extra = ensureMetadataExtra(transaction);
  extra.authorizationMode = auth.signature
    ? transaction.onchain?.required
      ? "pin+signature+onchain"
      : "pin+signature"
    : transaction.onchain?.required
      ? "pin+onchain"
      : "pin";
}

function updateDarajaResponse(transaction, response, rawRequest, originatorConversationId) {
  transaction.daraja = {
    ...transaction.daraja,
    checkoutRequestId: response.data?.CheckoutRequestID || transaction.daraja?.checkoutRequestId || null,
    conversationId: response.data?.ConversationID || transaction.daraja?.conversationId || null,
    customerMessage: response.data?.CustomerMessage || transaction.daraja?.customerMessage || null,
    merchantRequestId: response.data?.MerchantRequestID || transaction.daraja?.merchantRequestId || null,
    originatorConversationId:
      response.data?.OriginatorConversationID ||
      transaction.daraja?.originatorConversationId ||
      originatorConversationId,
    rawRequest,
    rawResponse: response.data || null,
    responseCode: String(response.data?.ResponseCode || ""),
    responseDescription: response.data?.ResponseDescription || null,
  };
}

function canReturnExistingTransaction(status) {
  return [
    "mpesa_submitted",
    "mpesa_processing",
    "succeeded",
    "failed",
    "refund_pending",
    "refunded",
  ].includes(status);
}

async function initiateOnrampStk(input, options = {}) {
  ensureMpesaEnabled();
  if (!hasTreasuryTransferConfig()) {
    throw createHttpError(
      "Top-up settlement is not configured. Set TREASURY_RPC_URL, TREASURY_PRIVATE_KEY, and TREASURY_USDC_CONTRACT.",
      503
    );
  }

  const userAddress = normalizeAddress(input.userAddress);
  const idempotencyKey = normalizeOptionalText(input.idempotencyKey);

  if (!normalizeOptionalText(input.transactionId) && !normalizeOptionalText(input.quoteId)) {
    throw createHttpError("transactionId or quoteId is required.");
  }

  if (idempotencyKey) {
    const existingByIdempotency = await findTransactionContext(
      { flowType: "onramp", idempotencyKey, userAddress },
      options
    );
    if (existingByIdempotency && existingByIdempotency.transaction.status !== "quoted") {
      return toPublicTransaction(existingByIdempotency.transaction);
    }
  }

  const context = await findTransactionContext(
    {
      flowType: "onramp",
      quoteId: input.quoteId,
      transactionId: input.transactionId,
      userAddress,
    },
    options
  );
  if (!context) {
    throw createHttpError("Transaction not found.", 404);
  }

  const transaction = context.transaction;
  if (canReturnExistingTransaction(transaction.status)) {
    return toPublicTransaction(transaction);
  }
  if (isQuoteExpired(transaction.quote)) {
    throw createHttpError("Quote has expired. Please generate a new quote.");
  }

  const phoneNumber = normalizePhone(input.phoneNumber || transaction.targets?.phoneNumber || "");
  if (!isValidPhone(phoneNumber)) {
    throw createHttpError("phoneNumber must be in 2547XXXXXXXX format.");
  }

  transaction.idempotencyKey = idempotencyKey || transaction.idempotencyKey || null;
  transaction.targets = {
    ...transaction.targets,
    phoneNumber,
  };

  if (transaction.status === "quoted") {
    assertTransition(transaction, "mpesa_submitted", "Submitting STK push", "api");
  }

  const mpesaClient = options.mpesaClient || {
    initiateStkPush,
  };

  const callbackUrl = buildCallbackUrl("stk", transaction.transactionId);
  const response = await mpesaClient.initiateStkPush({
    amountKes: transaction.quote.amountKes,
    phoneNumber,
    callbackUrl,
    accountReference: `DOTPAY-${transaction.transactionId}`,
    transactionDesc: "DotPay wallet top up",
    transactionType: "CustomerPayBillOnline",
  });

  updateDarajaResponse(
    transaction,
    response,
    {
      endpoint: "stkpush",
      callbackUrl,
    },
    transaction.transactionId
  );

  if (response.ok && String(response.data?.ResponseCode || "") === "0") {
    assertTransition(transaction, "mpesa_processing", "STK request accepted", "daraja");
  } else {
    assertTransition(transaction, "failed", "STK request rejected", "daraja");
  }

  await saveTransactionContext(context);
  return toPublicTransaction(transaction);
}

async function initiateMpesaFlow(input, options = {}) {
  ensureMpesaEnabled();

  const flowType = String(input.flowType || "").trim().toLowerCase();
  if (!MPESA_INITIATION_FLOWS.has(flowType)) {
    throw createHttpError("Only cashout, paybill, and till initiation are supported.");
  }

  const userAddress = normalizeAddress(input.userAddress);
  const idempotencyKey = normalizeOptionalText(input.idempotencyKey);

  if (!normalizeOptionalText(input.transactionId) && !normalizeOptionalText(input.quoteId)) {
    throw createHttpError("transactionId or quoteId is required.");
  }

  if (idempotencyKey) {
    const existingByIdempotency = await findTransactionContext(
      { flowType, idempotencyKey, userAddress },
      options
    );
    if (existingByIdempotency && existingByIdempotency.transaction.status !== "quoted") {
      return toPublicTransaction(existingByIdempotency.transaction);
    }
  }

  const context = await findTransactionContext(
    {
      flowType,
      quoteId: input.quoteId,
      transactionId: input.transactionId,
      userAddress,
    },
    options
  );

  if (!context) {
    throw createHttpError("Transaction not found.", 404);
  }

  const transaction = context.transaction;
  if (canReturnExistingTransaction(transaction.status)) {
    return toPublicTransaction(transaction);
  }
  if (isQuoteExpired(transaction.quote)) {
    throw createHttpError("Quote has expired. Please generate a new quote.");
  }

  const auth = ensureSensitiveAuth(input);
  const pinVerified = await verifyUserPinForAddress(userAddress, auth.pin, {
    filePath: options.userStoreFilePath,
  });
  if (!pinVerified) {
    throw createHttpError("Invalid PIN.", 401);
  }

  transaction.idempotencyKey = idempotencyKey || transaction.idempotencyKey || null;
  transaction.businessId = normalizeOptionalText(input.businessId) || transaction.businessId || null;
  transaction.targets = resolveTargets(flowType, transaction, input);
  updateAuthorizationMetadata(transaction, auth);

  if (transaction.status === "quoted") {
    assertTransition(transaction, "awaiting_user_authorization", "User authorization captured", "api");
  }

  try {
    if (transaction.onchain?.required && transaction.status === "awaiting_user_authorization") {
      assertTransition(transaction, "awaiting_onchain_funding", "Awaiting on-chain funding", "api");
    }

    await verifyFundingIfRequired(transaction, userAddress, input, options);
  } catch (error) {
    if (error.persistTransaction) {
      await saveTransactionContext(context);
    }
    throw error;
  }

  if (transaction.status === "awaiting_user_authorization" || transaction.status === "awaiting_onchain_funding") {
    assertTransition(
      transaction,
      "mpesa_submitted",
      flowType === "offramp" ? "Submitting B2C payout" : "Submitting B2B payment",
      "api"
    );
  }

  const mpesaClient = options.mpesaClient || {
    initiateB2B,
    initiateB2C,
  };

  if (flowType === "offramp") {
    const resultUrl = buildCallbackUrl("b2c_result", transaction.transactionId);
    const timeoutUrl = buildCallbackUrl("b2c_timeout", transaction.transactionId);
    const response = await mpesaClient.initiateB2C({
      amountKes: transaction.quote.expectedReceiveKes,
      commandId: mpesaConfig.commands?.b2cOfframp || "BusinessPayment",
      occasion: "DotPay cashout",
      originatorConversationId: transaction.transactionId,
      phoneNumber: transaction.targets.phoneNumber,
      remarks: "DotPay wallet cashout",
      resultUrl,
      timeoutUrl,
    });

    updateDarajaResponse(
      transaction,
      response,
      {
        endpoint: "b2c",
        resultUrl,
        timeoutUrl,
      },
      transaction.transactionId
    );

    if (response.ok && String(response.data?.ResponseCode || "") === "0") {
      assertTransition(transaction, "mpesa_processing", "B2C request accepted", "daraja");
    } else {
      assertTransition(transaction, "failed", "B2C request rejected", "daraja");
    }

    await saveTransactionContext(context);
    return toPublicTransaction(transaction);
  }

  const resultUrl = buildCallbackUrl("b2b_result", transaction.transactionId);
  const timeoutUrl = buildCallbackUrl("b2b_timeout", transaction.transactionId);
  const isPaybill = flowType === "paybill";
  const response = await mpesaClient.initiateB2B({
    accountReference:
      isPaybill
        ? transaction.targets.accountReference
        : transaction.targets.accountReference || "DotPay",
    amountKes: transaction.quote.expectedReceiveKes,
    commandId:
      isPaybill
        ? mpesaConfig.commands?.b2bPaybill || "BusinessPayBill"
        : mpesaConfig.commands?.b2bBuygoods || "BusinessBuyGoods",
    initiatorNameOverride:
      isPaybill
        ? mpesaConfig.credentials?.b2bPaybillInitiatorName || ""
        : mpesaConfig.credentials?.b2bBuygoodsInitiatorName || "",
    originatorConversationId: transaction.transactionId,
    receiverIdentifierType:
      isPaybill
        ? "4"
        : mpesaConfig.commands?.b2bBuygoodsReceiverIdentifierType || "2",
    receiverNumber: isPaybill ? transaction.targets.paybillNumber : transaction.targets.tillNumber,
    remarks: isPaybill ? "DotPay merchant paybill" : "DotPay buy goods",
    requester:
      normalizeOptionalText(input.requester) ||
      mpesaConfig.credentials?.b2bRequester ||
      "",
    resultUrl,
    securityCredentialOverride:
      isPaybill
        ? mpesaConfig.credentials?.b2bPaybillSecurityCredential || ""
        : mpesaConfig.credentials?.b2bBuygoodsSecurityCredential || "",
    timeoutUrl,
  });

  updateDarajaResponse(
    transaction,
    response,
    {
      endpoint: isPaybill ? "b2b_paybill" : "b2b_buygoods",
      resultUrl,
      timeoutUrl,
    },
    transaction.transactionId
  );

  if (response.ok && String(response.data?.ResponseCode || "") === "0") {
    assertTransition(
      transaction,
      "mpesa_processing",
      isPaybill ? "B2B paybill accepted" : "B2B buygoods accepted",
      "daraja"
    );
  } else {
    assertTransition(
      transaction,
      "failed",
      isPaybill ? "B2B paybill rejected" : "B2B buygoods rejected",
      "daraja"
    );
  }

  await saveTransactionContext(context);
  return toPublicTransaction(transaction);
}

function normalizeResultCode(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function withMpesaActionHint(code, resultDesc) {
  const base = String(resultDesc || "").trim() || "M-Pesa request failed.";
  const normalized = normalizeResultCode(code);

  if (normalized === "8006") {
    return `${base} Action required: reset or unlock the Daraja initiator security credential, then update the production credential and retry.`;
  }
  if (normalized === "2001") {
    return `${base} Action required: verify the initiator name and security credential pairing for this M-Pesa product.`;
  }

  return base;
}

function parseResultCode(value) {
  const raw = value === undefined || value === null ? null : String(value).trim() || null;
  const asNumber = raw === null ? NaN : Number(raw);
  return {
    raw,
    number: Number.isFinite(asNumber) ? asNumber : null,
    key: raw ?? "unknown",
    isSuccess: raw === "0" || asNumber === 0,
  };
}

function findReceiptFromResult(result) {
  const list = result?.ResultParameters?.ResultParameter;
  if (!Array.isArray(list)) return null;

  const target = list.find((item) => {
    const key = String(item?.Key || "").toLowerCase();
    return key === "transactionreceipt" || key === "transactionid";
  });

  return target?.Value ? String(target.Value).trim() : null;
}

function recordWebhookEvent(transaction, eventKey) {
  const extra = ensureMetadataExtra(transaction);
  const existingKeys = Array.isArray(extra.mpesaEventKeys) ? extra.mpesaEventKeys : [];
  if (existingKeys.includes(eventKey)) {
    return false;
  }

  extra.mpesaEventKeys = [...existingKeys.slice(-49), eventKey];
  return true;
}

function maybeTransitionToSuccess(transaction, reason) {
  if (transaction.status === "mpesa_processing" || transaction.status === "mpesa_submitted") {
    assertTransition(transaction, "succeeded", reason, "webhook");
  }
}

function maybeTransitionToFailure(transaction, reason) {
  if (
    transaction.status === "quoted" ||
    transaction.status === "awaiting_user_authorization" ||
    transaction.status === "awaiting_onchain_funding" ||
    transaction.status === "mpesa_submitted" ||
    transaction.status === "mpesa_processing"
  ) {
    assertTransition(transaction, "failed", reason, "webhook");
  }
}

async function processStkWebhook({ payload, transactionId }, options = {}) {
  const stk = payload?.Body?.stkCallback || {};
  const checkoutRequestId = stk?.CheckoutRequestID;
  const merchantRequestId = stk?.MerchantRequestID;
  const parsedCode = parseResultCode(stk?.ResultCode);
  const resultDesc = normalizeOptionalText(stk?.ResultDesc);

  const context = await findTransactionContextByWebhookRefs(
    {
      checkoutRequestId,
      merchantRequestId,
      transactionId,
    },
    options
  );
  if (!context) return null;

  const eventKey = `stk:${context.transaction.transactionId}:${checkoutRequestId || "none"}:${parsedCode.key}`;
  if (!recordWebhookEvent(context.transaction, eventKey)) {
    return toPublicTransaction(context.transaction);
  }

  const metadataItems = stk?.CallbackMetadata?.Item;
  const metadata = Array.isArray(metadataItems) ? metadataItems : [];
  const receiptItem = metadata.find((item) => String(item?.Name || "") === "MpesaReceiptNumber");
  const receiptNumber = receiptItem?.Value ? String(receiptItem.Value).trim() : null;

  context.transaction.daraja = {
    ...context.transaction.daraja,
    merchantRequestId:
      normalizeOptionalText(merchantRequestId) ||
      context.transaction.daraja?.merchantRequestId ||
      null,
    checkoutRequestId:
      normalizeOptionalText(checkoutRequestId) ||
      context.transaction.daraja?.checkoutRequestId ||
      null,
    resultCode: parsedCode.number,
    resultCodeRaw: parsedCode.raw,
    resultDesc,
    receiptNumber: receiptNumber || context.transaction.daraja?.receiptNumber || null,
    rawCallback: payload,
    callbackReceivedAt: nowIso(),
  };

  if (parsedCode.isSuccess) {
    const settlementService = options.settlementService || {
      settleOnrampToUserWallet,
    };

    try {
      await settlementService.settleOnrampToUserWallet(context.transaction, options);
      maybeTransitionToSuccess(context.transaction, "STK callback success");
    } catch (error) {
      const reason = String(error?.message || "On-chain settlement failed.").trim();
      context.transaction.onchain = {
        ...(context.transaction.onchain || {}),
        verificationStatus: "failed",
        verificationError: reason,
        verifiedBy: "treasury_settlement",
        verifiedAt: nowIso(),
      };
      context.transaction.daraja = {
        ...context.transaction.daraja,
        resultDesc: `${resultDesc || "STK callback success"} | Settlement error: ${reason}`,
      };
      maybeTransitionToFailure(context.transaction, "On-chain settlement failed");
    }
  } else {
    maybeTransitionToFailure(context.transaction, "STK callback failure");
  }

  await saveTransactionContext(context);
  return toPublicTransaction(context.transaction);
}

async function processB2cResultWebhook({ payload, transactionId }, options = {}) {
  const result = payload?.Result || {};
  const conversationId = result?.ConversationID;
  const originatorConversationId = result?.OriginatorConversationID;
  const parsedCode = parseResultCode(result?.ResultCode);
  const resultDesc = withMpesaActionHint(parsedCode.raw, result?.ResultDesc);

  const context = await findTransactionContextByWebhookRefs(
    {
      conversationId,
      originatorConversationId,
      transactionId,
    },
    options
  );
  if (!context) return null;

  const eventKey = `b2c_result:${context.transaction.transactionId}:${conversationId || "none"}:${parsedCode.key}`;
  if (!recordWebhookEvent(context.transaction, eventKey)) {
    return toPublicTransaction(context.transaction);
  }

  const receiptNumber = findReceiptFromResult(result);
  context.transaction.daraja = {
    ...context.transaction.daraja,
    callbackReceivedAt: nowIso(),
    conversationId: normalizeOptionalText(conversationId) || context.transaction.daraja?.conversationId || null,
    originatorConversationId:
      normalizeOptionalText(originatorConversationId) ||
      context.transaction.daraja?.originatorConversationId ||
      null,
    rawCallback: payload,
    receiptNumber: receiptNumber || context.transaction.daraja?.receiptNumber || null,
    resultCode: parsedCode.number,
    resultCodeRaw: parsedCode.raw,
    resultDesc,
  };

  if (parsedCode.isSuccess) {
    maybeTransitionToSuccess(context.transaction, "B2C callback success");
  } else {
    maybeTransitionToFailure(context.transaction, "B2C callback failure");
  }

  await saveTransactionContext(context);
  return toPublicTransaction(context.transaction);
}

async function processB2cTimeoutWebhook({ payload, transactionId }, options = {}) {
  const conversationId = payload?.Result?.ConversationID || payload?.ConversationID;
  const originatorConversationId =
    payload?.Result?.OriginatorConversationID || payload?.OriginatorConversationID;

  const context = await findTransactionContextByWebhookRefs(
    {
      conversationId,
      originatorConversationId,
      transactionId,
    },
    options
  );
  if (!context) return null;

  const eventKey = `b2c_timeout:${context.transaction.transactionId}:${conversationId || "none"}`;
  if (!recordWebhookEvent(context.transaction, eventKey)) {
    return toPublicTransaction(context.transaction);
  }

  context.transaction.daraja = {
    ...context.transaction.daraja,
    callbackReceivedAt: nowIso(),
    rawCallback: payload,
    resultDesc: "Timeout",
  };
  maybeTransitionToFailure(context.transaction, "B2C timeout callback");

  await saveTransactionContext(context);
  return toPublicTransaction(context.transaction);
}

async function processB2bResultWebhook({ payload, transactionId }, options = {}) {
  const result = payload?.Result || {};
  const conversationId = result?.ConversationID;
  const originatorConversationId = result?.OriginatorConversationID;
  const parsedCode = parseResultCode(result?.ResultCode);
  const resultDesc = normalizeOptionalText(result?.ResultDesc);

  const context = await findTransactionContextByWebhookRefs(
    {
      conversationId,
      originatorConversationId,
      transactionId,
    },
    options
  );
  if (!context) return null;

  const eventKey = `b2b_result:${context.transaction.transactionId}:${conversationId || "none"}:${parsedCode.key}`;
  if (!recordWebhookEvent(context.transaction, eventKey)) {
    return toPublicTransaction(context.transaction);
  }

  context.transaction.daraja = {
    ...context.transaction.daraja,
    callbackReceivedAt: nowIso(),
    conversationId: normalizeOptionalText(conversationId) || context.transaction.daraja?.conversationId || null,
    originatorConversationId:
      normalizeOptionalText(originatorConversationId) ||
      context.transaction.daraja?.originatorConversationId ||
      null,
    rawCallback: payload,
    receiptNumber: findReceiptFromResult(result) || context.transaction.daraja?.receiptNumber || null,
    resultCode: parsedCode.number,
    resultCodeRaw: parsedCode.raw,
    resultDesc,
  };

  if (parsedCode.isSuccess) {
    maybeTransitionToSuccess(context.transaction, "B2B callback success");
  } else {
    maybeTransitionToFailure(context.transaction, "B2B callback failure");
  }

  await saveTransactionContext(context);
  return toPublicTransaction(context.transaction);
}

async function processB2bTimeoutWebhook({ payload, transactionId }, options = {}) {
  const conversationId = payload?.Result?.ConversationID || payload?.ConversationID;
  const originatorConversationId =
    payload?.Result?.OriginatorConversationID || payload?.OriginatorConversationID;

  const context = await findTransactionContextByWebhookRefs(
    {
      conversationId,
      originatorConversationId,
      transactionId,
    },
    options
  );
  if (!context) return null;

  const eventKey = `b2b_timeout:${context.transaction.transactionId}:${conversationId || "none"}`;
  if (!recordWebhookEvent(context.transaction, eventKey)) {
    return toPublicTransaction(context.transaction);
  }

  context.transaction.daraja = {
    ...context.transaction.daraja,
    callbackReceivedAt: nowIso(),
    rawCallback: payload,
    resultDesc: "Timeout",
  };
  maybeTransitionToFailure(context.transaction, "B2B timeout callback");

  await saveTransactionContext(context);
  return toPublicTransaction(context.transaction);
}

function createWebhookAck() {
  return {
    ResultCode: 0,
    ResultDesc: "Accepted",
  };
}

module.exports = {
  createWebhookAck,
  initiateOnrampStk,
  initiateMpesaFlow,
  processStkWebhook,
  processB2bResultWebhook,
  processB2bTimeoutWebhook,
  processB2cResultWebhook,
  processB2cTimeoutWebhook,
};
