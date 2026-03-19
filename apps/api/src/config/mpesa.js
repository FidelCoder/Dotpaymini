const { ethers } = require("ethers");

const DEFAULT_SANDBOX_BASE_URL = "https://sandbox.safaricom.co.ke";
const DEFAULT_PRODUCTION_BASE_URL = "https://api.safaricom.co.ke";

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const envRaw = String(process.env.MPESA_ENV || "").trim().toLowerCase();
const env = envRaw === "production" ? "production" : "sandbox";
const envPrefix = env === "production" ? "MPESA_PROD_" : "MPESA_DEV_";

function pickMpesaEnvValue(suffix, fallback = "") {
  const envScoped = String(process.env[`${envPrefix}${suffix}`] || "").trim();
  if (envScoped) return envScoped;

  const generic = String(process.env[`MPESA_${suffix}`] || "").trim();
  if (generic) return generic;

  return String(fallback || "").trim();
}

function pickMpesaScopedValue(suffix, fallback = "") {
  const envScoped = String(process.env[`${envPrefix}${suffix}`] || "").trim();
  if (envScoped) return envScoped;
  return String(fallback || "").trim();
}

function pickMpesaGenericValue(suffix, fallback = "") {
  const generic = String(process.env[`MPESA_${suffix}`] || "").trim();
  if (generic) return generic;
  return String(fallback || "").trim();
}

function deriveTreasuryAddressFromPrivateKey(privateKey) {
  const normalized = String(privateKey || "").trim();
  if (!normalized) return "";

  try {
    return new ethers.Wallet(normalized).address;
  } catch {
    return "";
  }
}

const baseUrl =
  normalizeUrl(process.env.MPESA_BASE_URL) ||
  (env === "production" ? DEFAULT_PRODUCTION_BASE_URL : DEFAULT_SANDBOX_BASE_URL);

const webhookBaseUrl = normalizeUrl(process.env.MPESA_WEBHOOK_URL || "");
const resultBaseUrl = normalizeUrl(
  process.env.MPESA_RESULT_BASE_URL || webhookBaseUrl || process.env.NEXT_PUBLIC_API_URL
);
const timeoutBaseUrl = normalizeUrl(
  process.env.MPESA_TIMEOUT_BASE_URL || webhookBaseUrl || process.env.NEXT_PUBLIC_API_URL
);

const treasuryPrivateKey = String(process.env.TREASURY_PRIVATE_KEY || "").trim();
const treasuryAddress =
  String(process.env.TREASURY_PLATFORM_ADDRESS || "").trim() ||
  deriveTreasuryAddressFromPrivateKey(treasuryPrivateKey);

const securityCredential = pickMpesaEnvValue("SECURITY_CREDENTIAL");

const mpesaConfig = {
  enabled: toBool(process.env.MPESA_ENABLED, false),
  env,
  baseUrl,
  oauthUrl: `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
  endpoints: {
    stkPush: `${baseUrl}/mpesa/stkpush/v1/processrequest`,
    stkQuery: `${baseUrl}/mpesa/stkpushquery/v1/query`,
    b2cPayment:
      String(process.env.MPESA_B2C_API_VERSION || "")
        .trim()
        .toLowerCase() === "v1"
        ? `${baseUrl}/mpesa/b2c/v1/paymentrequest`
        : `${baseUrl}/mpesa/b2c/v3/paymentrequest`,
    b2bPayment: `${baseUrl}/mpesa/b2b/v1/paymentrequest`,
    transactionStatus: `${baseUrl}/mpesa/transactionstatus/v1/query`,
  },
  credentials: {
    consumerKey: pickMpesaEnvValue("CONSUMER_KEY"),
    consumerSecret: pickMpesaEnvValue("CONSUMER_SECRET"),
    shortcode: pickMpesaEnvValue("SHORTCODE"),
    stkShortcode: pickMpesaEnvValue("STK_SHORTCODE", pickMpesaEnvValue("SHORTCODE")),
    b2cShortcode: pickMpesaEnvValue("B2C_SHORTCODE", pickMpesaEnvValue("SHORTCODE")),
    b2bShortcode: pickMpesaEnvValue("B2B_SHORTCODE", pickMpesaEnvValue("SHORTCODE")),
    passkey: pickMpesaEnvValue("PASSKEY"),
    initiatorName: pickMpesaEnvValue("INITIATOR_NAME"),
    securityCredential,
    b2cInitiatorName:
      pickMpesaScopedValue("B2C_INITIATOR_NAME") ||
      pickMpesaScopedValue("INITIATOR_NAME") ||
      pickMpesaGenericValue("B2C_INITIATOR_NAME") ||
      pickMpesaGenericValue("INITIATOR_NAME"),
    b2cSecurityCredential:
      pickMpesaScopedValue("B2C_SECURITY_CREDENTIAL") ||
      securityCredential ||
      pickMpesaGenericValue("B2C_SECURITY_CREDENTIAL"),
    b2bInitiatorName:
      pickMpesaScopedValue("B2B_INITIATOR_NAME") ||
      pickMpesaScopedValue("INITIATOR_NAME") ||
      pickMpesaGenericValue("B2B_INITIATOR_NAME") ||
      pickMpesaGenericValue("INITIATOR_NAME"),
    b2bSecurityCredential:
      pickMpesaScopedValue("B2B_SECURITY_CREDENTIAL") ||
      securityCredential ||
      pickMpesaGenericValue("B2B_SECURITY_CREDENTIAL"),
    b2bPaybillInitiatorName:
      pickMpesaScopedValue("B2B_PAYBILL_INITIATOR_NAME") ||
      pickMpesaScopedValue("B2B_INITIATOR_NAME") ||
      pickMpesaScopedValue("INITIATOR_NAME") ||
      pickMpesaGenericValue("B2B_PAYBILL_INITIATOR_NAME") ||
      pickMpesaGenericValue("B2B_INITIATOR_NAME") ||
      pickMpesaGenericValue("INITIATOR_NAME"),
    b2bPaybillSecurityCredential:
      pickMpesaScopedValue("B2B_PAYBILL_SECURITY_CREDENTIAL") ||
      pickMpesaScopedValue("B2B_SECURITY_CREDENTIAL") ||
      securityCredential ||
      pickMpesaGenericValue("B2B_PAYBILL_SECURITY_CREDENTIAL") ||
      pickMpesaGenericValue("B2B_SECURITY_CREDENTIAL"),
    b2bBuygoodsInitiatorName:
      pickMpesaScopedValue("B2B_BUYGOODS_INITIATOR_NAME") ||
      pickMpesaScopedValue("B2B_INITIATOR_NAME") ||
      pickMpesaScopedValue("INITIATOR_NAME") ||
      pickMpesaGenericValue("B2B_BUYGOODS_INITIATOR_NAME") ||
      pickMpesaGenericValue("B2B_INITIATOR_NAME") ||
      pickMpesaGenericValue("INITIATOR_NAME"),
    b2bBuygoodsSecurityCredential:
      pickMpesaScopedValue("B2B_BUYGOODS_SECURITY_CREDENTIAL") ||
      pickMpesaScopedValue("B2B_SECURITY_CREDENTIAL") ||
      securityCredential ||
      pickMpesaGenericValue("B2B_BUYGOODS_SECURITY_CREDENTIAL") ||
      pickMpesaGenericValue("B2B_SECURITY_CREDENTIAL"),
    b2bRequester:
      pickMpesaScopedValue("B2B_REQUESTER") ||
      pickMpesaGenericValue("B2B_REQUESTER"),
  },
  commands: {
    b2cOfframp: String(process.env.MPESA_B2C_COMMAND_ID || "BusinessPayment").trim(),
    b2bPaybill: String(process.env.MPESA_B2B_PAYBILL_COMMAND_ID || "BusinessPayBill").trim(),
    b2bBuygoods: String(process.env.MPESA_B2B_BUYGOODS_COMMAND_ID || "BusinessBuyGoods").trim(),
    b2bBuygoodsReceiverIdentifierType: String(
      process.env.MPESA_B2B_BUYGOODS_RECEIVER_IDENTIFIER_TYPE || "2"
    ).trim(),
  },
  callbacks: {
    resultBaseUrl,
    timeoutBaseUrl,
    webhookSecret: String(process.env.MPESA_WEBHOOK_SECRET || "").trim(),
  },
  limits: {
    minTxnKes: Math.max(1, toNumber(process.env.MPESA_MIN_TXN_KES, 10)),
    maxTxnKes: toNumber(process.env.MPESA_MAX_TXN_KES, 150000),
    maxDailyKes: toNumber(process.env.MPESA_MAX_DAILY_KES, 500000),
  },
  quote: {
    ttlSeconds: toNumber(process.env.MPESA_QUOTE_TTL_SECONDS, 300),
    defaultRateKesPerUsd: toNumber(process.env.KES_PER_USD, 130),
  },
  security: {
    pinMinLength: toNumber(process.env.MPESA_PIN_MIN_LENGTH, 6),
    signatureMaxAgeSeconds: toNumber(process.env.MPESA_SIGNATURE_MAX_AGE_SECONDS, 600),
  },
  treasury: {
    rpcUrl: normalizeUrl(process.env.TREASURY_RPC_URL),
    privateKey: treasuryPrivateKey,
    address: treasuryAddress ? treasuryAddress.toLowerCase() : "",
    usdcContract: String(process.env.TREASURY_USDC_CONTRACT || "").trim().toLowerCase(),
    chainId: toNumber(process.env.TREASURY_CHAIN_ID, 0) || null,
    usdcDecimals: toNumber(process.env.TREASURY_USDC_DECIMALS, 6),
    waitConfirmations: Math.max(1, toNumber(process.env.TREASURY_WAIT_CONFIRMATIONS, 1)),
  },
  settlement: {
    requireOnchainFunding: toBool(process.env.MPESA_REQUIRE_ONCHAIN_FUNDING, true),
    minFundingConfirmations: Math.max(1, toNumber(process.env.MPESA_MIN_FUNDING_CONFIRMATIONS, 1)),
  },
};

function ensureMpesaConfigured() {
  const missing = [];

  if (!mpesaConfig.credentials.consumerKey) missing.push("MPESA_CONSUMER_KEY");
  if (!mpesaConfig.credentials.consumerSecret) missing.push("MPESA_CONSUMER_SECRET");
  if (!mpesaConfig.credentials.b2cShortcode) missing.push("MPESA_B2C_SHORTCODE or MPESA_SHORTCODE");
  if (!mpesaConfig.credentials.b2bShortcode) missing.push("MPESA_B2B_SHORTCODE or MPESA_SHORTCODE");
  if (!mpesaConfig.callbacks.resultBaseUrl) missing.push("MPESA_RESULT_BASE_URL or MPESA_WEBHOOK_URL");
  if (!mpesaConfig.callbacks.timeoutBaseUrl) missing.push("MPESA_TIMEOUT_BASE_URL or MPESA_WEBHOOK_URL");

  if (mpesaConfig.settlement.requireOnchainFunding) {
    if (!mpesaConfig.treasury.rpcUrl) missing.push("TREASURY_RPC_URL");
    if (!mpesaConfig.treasury.usdcContract) missing.push("TREASURY_USDC_CONTRACT");
    if (!mpesaConfig.treasury.address) {
      missing.push("TREASURY_PLATFORM_ADDRESS (or TREASURY_PRIVATE_KEY)");
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing M-Pesa configuration: ${missing.join(", ")}`);
  }
}

module.exports = {
  mpesaConfig,
  ensureMpesaConfigured,
};
