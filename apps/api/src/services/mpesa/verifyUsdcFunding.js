const { ethers } = require("ethers");
const { mpesaConfig } = require("../../config/mpesa");

const ERC20_IFACE = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function parsePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function toScaledInt(value, scale) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Funding amount inputs must be positive numbers.");
  }

  const factor = 10 ** scale;
  return BigInt(Math.round(parsed * factor));
}

function calculateExpectedFundingFromQuote(quote, decimals = 6) {
  const safeDecimals = Math.max(0, Math.min(18, Number(decimals || 6)));
  const totalDebitKesScaled = toScaledInt(quote?.totalDebitKes, 6);
  const rateKesPerUsdScaled = toScaledInt(quote?.rateKesPerUsd, 6);
  const tokenScale = 10n ** BigInt(safeDecimals);

  const expectedUnits =
    (totalDebitKesScaled * tokenScale + rateKesPerUsdScaled - 1n) / rateKesPerUsdScaled;

  if (expectedUnits <= 0n) {
    throw new Error("Calculated funding amount is zero.");
  }

  const expectedUsd = Number.parseFloat(ethers.formatUnits(expectedUnits, safeDecimals));
  return {
    expectedUnits,
    expectedUnitsString: expectedUnits.toString(),
    expectedUsd,
  };
}

async function verifyUsdcFunding({
  txHash,
  expectedFromAddress,
  providedChainId = null,
  expectedMinAmountUnits,
}) {
  const treasury = mpesaConfig.treasury || {};
  const settlement = mpesaConfig.settlement || {};
  const rpcUrl = String(treasury.rpcUrl || "").trim();
  const usdcContract = normalizeAddress(treasury.usdcContract);
  const treasuryAddress = normalizeAddress(treasury.address);
  const expectedFrom = normalizeAddress(expectedFromAddress);
  const txHashNormalized = String(txHash || "").trim().toLowerCase();
  const allowSenderFallback = toBool(
    process.env.MPESA_ALLOW_SMART_WALLET_FUNDING,
    mpesaConfig.env !== "production"
  );

  if (!rpcUrl) throw new Error("TREASURY_RPC_URL is required for funding verification.");
  if (!usdcContract) throw new Error("TREASURY_USDC_CONTRACT is required for funding verification.");
  if (!treasuryAddress) {
    throw new Error("TREASURY_PLATFORM_ADDRESS (or TREASURY_PRIVATE_KEY) is required for funding verification.");
  }
  if (!/^0x[a-f0-9]{40}$/.test(expectedFrom)) {
    throw new Error("Invalid sender wallet address.");
  }
  if (!/^0x[a-f0-9]{64}$/.test(txHashNormalized)) {
    throw new Error("Invalid onchainTxHash.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, treasury.chainId || undefined);
  const network = await provider.getNetwork();
  const networkChainId = Number(network.chainId);
  const configuredChainId = parsePositiveInteger(treasury.chainId);
  const requestChainId = parsePositiveInteger(providedChainId);

  if (configuredChainId && networkChainId !== configuredChainId) {
    throw new Error(`RPC chain mismatch. Expected ${configuredChainId}, got ${networkChainId}.`);
  }
  if (requestChainId && requestChainId !== networkChainId) {
    throw new Error(`Funding transaction is on chain ${requestChainId}, expected ${networkChainId}.`);
  }

  const receipt = await provider.getTransactionReceipt(txHashNormalized);
  if (!receipt) {
    throw new Error("Funding transaction receipt not found yet.");
  }
  if (Number(receipt.status) !== 1) {
    throw new Error("Funding transaction failed on-chain.");
  }

  const minConfirmations = Math.max(1, Number(settlement.minFundingConfirmations || 1));
  if (minConfirmations > 1) {
    const currentBlock = await provider.getBlockNumber();
    const confirmations = currentBlock - Number(receipt.blockNumber) + 1;
    if (confirmations < minConfirmations) {
      throw new Error(
        `Funding transaction needs ${minConfirmations} confirmations (current: ${confirmations}).`
      );
    }
  }

  const candidateTransfers = [];

  for (const log of receipt.logs || []) {
    if (normalizeAddress(log.address) !== usdcContract) continue;

    let parsed;
    try {
      parsed = ERC20_IFACE.parseLog(log);
    } catch {
      continue;
    }

    if (String(parsed?.name || "") !== "Transfer") continue;

    const fromAddress = normalizeAddress(parsed.args?.from);
    const toAddress = normalizeAddress(parsed.args?.to);
    const amount = BigInt(parsed.args?.value?.toString() || "0");

    if (toAddress !== treasuryAddress) continue;
    if (amount <= 0n) continue;

    const logIndex =
      log.logIndex === undefined || log.logIndex === null ? null : Number(log.logIndex);

    candidateTransfers.push({
      amount,
      fromAddress,
      logIndex: Number.isFinite(logIndex) ? logIndex : null,
    });
  }

  const strictMatches = candidateTransfers.filter((entry) => entry.fromAddress === expectedFrom);
  let selectedMatches = strictMatches;
  let fundingSender = expectedFrom;

  if (selectedMatches.length === 0 && allowSenderFallback && candidateTransfers.length > 0) {
    if (candidateTransfers.length !== 1) {
      throw new Error(
        "On-chain transfer proof is ambiguous. Found multiple USDC transfers to treasury in this transaction."
      );
    }

    selectedMatches = candidateTransfers;
    fundingSender = candidateTransfers[0].fromAddress;
  }

  let fundedAmountUnits = 0n;
  let firstMatchLogIndex = null;
  for (const match of selectedMatches) {
    fundedAmountUnits += match.amount;
    if (firstMatchLogIndex === null) {
      firstMatchLogIndex = match.logIndex;
    } else if (
      Number.isFinite(match.logIndex) &&
      (firstMatchLogIndex === null || match.logIndex < firstMatchLogIndex)
    ) {
      firstMatchLogIndex = match.logIndex;
    }
  }

  if (strictMatches.length === 0 && !allowSenderFallback && candidateTransfers.length > 0) {
    throw new Error("Funding transfer sender does not match authenticated wallet. Reconnect and retry.");
  }

  if (fundedAmountUnits <= 0n) {
    throw new Error(
      "On-chain transfer proof not found. Send USDC from your wallet to the platform treasury address."
    );
  }
  if (fundedAmountUnits < expectedMinAmountUnits) {
    throw new Error("Funding transfer is below the required amount.");
  }

  const safeDecimals = Math.max(0, Math.min(18, Number(treasury.usdcDecimals || 6)));
  const fundedAmountUsd = Number.parseFloat(ethers.formatUnits(fundedAmountUnits, safeDecimals));

  return {
    txHash: txHashNormalized,
    chainId: networkChainId,
    tokenAddress: usdcContract,
    treasuryAddress,
    fromAddress: fundingSender,
    toAddress: treasuryAddress,
    fundedAmountUnits: fundedAmountUnits.toString(),
    fundedAmountUsd,
    expectedMinAmountUnits: expectedMinAmountUnits.toString(),
    logIndex: firstMatchLogIndex,
    blockNumber: Number(receipt.blockNumber),
  };
}

module.exports = {
  calculateExpectedFundingFromQuote,
  verifyUsdcFunding,
};
