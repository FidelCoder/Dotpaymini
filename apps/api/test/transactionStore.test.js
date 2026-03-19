process.env.MPESA_ENABLED = "true";
process.env.MPESA_ENV = "sandbox";
process.env.MPESA_CONSUMER_KEY = "test-consumer-key";
process.env.MPESA_CONSUMER_SECRET = "test-consumer-secret";
process.env.MPESA_B2C_SHORTCODE = "600111";
process.env.MPESA_B2B_SHORTCODE = "600111";
process.env.MPESA_RESULT_BASE_URL = "https://mini.example.com";
process.env.MPESA_TIMEOUT_BASE_URL = "https://mini.example.com";
process.env.MPESA_REQUIRE_ONCHAIN_FUNDING = "true";
process.env.TREASURY_RPC_URL = "https://rpc.example.com";
process.env.TREASURY_PRIVATE_KEY =
  "0x59c6995e998f97a5a004497e5daef9c9f8247d6a83895b2b37d1b0dff78ea9f3";
process.env.TREASURY_PLATFORM_ADDRESS = "0x9999999999999999999999999999999999999999";
process.env.TREASURY_USDC_CONTRACT = "0x1111111111111111111111111111111111111111";
process.env.TREASURY_CHAIN_ID = "84532";
process.env.TREASURY_USDC_DECIMALS = "6";
process.env.MPESA_B2C_INITIATOR_NAME = "dotpaymini-b2c";
process.env.MPESA_B2C_SECURITY_CREDENTIAL = "credential";
process.env.MPESA_B2B_INITIATOR_NAME = "dotpaymini-b2b";
process.env.MPESA_B2B_SECURITY_CREDENTIAL = "credential";
process.env.MPESA_B2B_PAYBILL_INITIATOR_NAME = "dotpaymini-paybill";
process.env.MPESA_B2B_PAYBILL_SECURITY_CREDENTIAL = "credential";
process.env.MPESA_B2B_BUYGOODS_INITIATOR_NAME = "dotpaymini-buygoods";
process.env.MPESA_B2B_BUYGOODS_SECURITY_CREDENTIAL = "credential";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { mkdir, rm } = require("fs/promises");

const {
  createQuotedTransaction,
  getTransactionById,
  listTransactions,
  transitionTransaction,
} = require("../src/services/transactionStore");
const {
  initiateOnrampStk,
  initiateMpesaFlow,
  processStkWebhook,
  processB2bResultWebhook,
  processB2cResultWebhook,
} = require("../src/services/mpesaFlowService");
const { setUserPin, upsertSessionUser } = require("../src/services/userStore");

function makeTxHash(seed = "a") {
  return `0x${seed.repeat(64)}`;
}

async function createWorkspace(prefix) {
  const tempDirPath = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await mkdir(tempDirPath, { recursive: true });

  return {
    tempDirPath,
    transactionFilePath: path.join(tempDirPath, "transactions.json"),
    userFilePath: path.join(tempDirPath, "users.json"),
  };
}

async function seedUser(userFilePath, address, pin = "123456") {
  await upsertSessionUser(
    {
      address,
      usernameHint: "@tester",
    },
    { filePath: userFilePath }
  );

  await setUserPin(address, pin, null, {
    filePath: userFilePath,
  });
}

function buildVerifiedFunding(address, txHash = makeTxHash("a")) {
  return {
    txHash,
    chainId: 84532,
    tokenAddress: "0x1111111111111111111111111111111111111111",
    treasuryAddress: "0x9999999999999999999999999999999999999999",
    fromAddress: address,
    toAddress: "0x9999999999999999999999999999999999999999",
    fundedAmountUnits: "7692308",
    fundedAmountUsd: 7.692308,
    expectedMinAmountUnits: "7692308",
    logIndex: 1,
    blockNumber: 12345,
  };
}

test("createQuotedTransaction creates a quoted transaction intent and supports idempotency", async () => {
  const workspace = await createWorkspace("dotpaymini-transactions");

  try {
    const first = await createQuotedTransaction(
      {
        userAddress: "0x1234567890abcdef1234567890abcdef12345678",
        flowType: "offramp",
        amount: 1200,
        currency: "KES",
        phoneNumber: "254700000001",
        idempotencyKey: "cashout-1",
      },
      { filePath: workspace.transactionFilePath }
    );

    assert.equal(first.transaction.status, "quoted");
    assert.equal(first.transaction.targets.phoneNumber, "254700000001");
    assert.equal(first.transaction.onchain.required, true);
    assert.equal(first.idempotent, false);
    assert.match(first.transaction.transactionId, /^MPX/);

    const second = await createQuotedTransaction(
      {
        userAddress: "0x1234567890abcdef1234567890abcdef12345678",
        flowType: "offramp",
        amount: 1200,
        currency: "KES",
        phoneNumber: "254700000001",
        idempotencyKey: "cashout-1",
      },
      { filePath: workspace.transactionFilePath }
    );

    assert.equal(second.idempotent, true);
    assert.equal(second.transaction.transactionId, first.transaction.transactionId);

    const loaded = await getTransactionById(first.transaction.transactionId, {
      filePath: workspace.transactionFilePath,
    });
    assert.ok(loaded);
    assert.equal(loaded.status, "quoted");

    const listed = await listTransactions(
      { userAddress: "0x1234567890abcdef1234567890abcdef12345678" },
      { filePath: workspace.transactionFilePath }
    );
    assert.equal(listed.length, 1);
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("transitionTransaction enforces the transaction state machine", async () => {
  const workspace = await createWorkspace("dotpaymini-state-machine");

  try {
    const created = await createQuotedTransaction(
      {
        userAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        flowType: "paybill",
        amount: 45,
        currency: "USD",
        phoneNumber: "254700000002",
        paybillNumber: "600000",
        accountReference: "INV-100",
      },
      { filePath: workspace.transactionFilePath }
    );

    const awaitingAuth = await transitionTransaction(
      created.transaction.transactionId,
      "awaiting_user_authorization",
      "Waiting for user confirmation.",
      "test",
      { filePath: workspace.transactionFilePath }
    );
    assert.equal(awaitingAuth.status, "awaiting_user_authorization");

    await assert.rejects(
      () =>
        transitionTransaction(
          created.transaction.transactionId,
          "refunded",
          "Skipping ahead should fail.",
          "test",
          { filePath: workspace.transactionFilePath }
        ),
      /Invalid status transition/
    );
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("initiateMpesaFlow verifies PIN, verifies funding, and stores accepted B2C Daraja details", async () => {
  const workspace = await createWorkspace("dotpaymini-offramp");
  const address = "0xcccccccccccccccccccccccccccccccccccccccc";
  const fundingHash = makeTxHash("a");

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "offramp",
        amount: 1000,
        currency: "KES",
        phoneNumber: "254700000003",
      },
      { filePath: workspace.transactionFilePath }
    );

    const initiated = await initiateMpesaFlow(
      {
        transactionId: quoted.transaction.transactionId,
        userAddress: address,
        flowType: "offramp",
        pin: "123456",
        idempotencyKey: "offramp:1",
        onchainTxHash: fundingHash,
      },
      {
        filePath: workspace.transactionFilePath,
        userStoreFilePath: workspace.userFilePath,
        fundingVerifier: async (payload) => {
          assert.equal(payload.txHash, fundingHash);
          assert.equal(payload.expectedFromAddress, address);
          return buildVerifiedFunding(address, fundingHash);
        },
        mpesaClient: {
          initiateB2B: async () => {
            throw new Error("B2B should not be called for offramp.");
          },
          initiateB2C: async (payload) => {
            assert.equal(payload.phoneNumber, "254700000003");
            assert.equal(payload.originatorConversationId, quoted.transaction.transactionId);
            assert.equal(payload.commandId, "BusinessPayment");
            return {
              ok: true,
              status: 200,
              data: {
                ResponseCode: "0",
                ResponseDescription: "Accepted for processing.",
                ConversationID: "AG_20260319_001",
                OriginatorConversationID: quoted.transaction.transactionId,
              },
            };
          },
        },
      }
    );

    assert.equal(initiated.status, "mpesa_processing");
    assert.equal(initiated.authorization.pinProvided, true);
    assert.equal(initiated.onchain.verificationStatus, "verified");
    assert.equal(initiated.onchain.txHash, fundingHash);
    assert.equal(initiated.daraja.responseCode, "0");
    assert.equal(initiated.daraja.conversationId, "AG_20260319_001");
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("processB2cResultWebhook moves an accepted payout into succeeded and keeps callbacks idempotent", async () => {
  const workspace = await createWorkspace("dotpaymini-b2c-callback");
  const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const fundingHash = makeTxHash("b");

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "offramp",
        amount: 900,
        currency: "KES",
        phoneNumber: "254700000004",
      },
      { filePath: workspace.transactionFilePath }
    );

    await initiateMpesaFlow(
      {
        transactionId: quoted.transaction.transactionId,
        userAddress: address,
        flowType: "offramp",
        pin: "123456",
        idempotencyKey: "offramp:2",
        onchainTxHash: fundingHash,
      },
      {
        filePath: workspace.transactionFilePath,
        userStoreFilePath: workspace.userFilePath,
        fundingVerifier: async () => buildVerifiedFunding(address, fundingHash),
        mpesaClient: {
          initiateB2B: async () => {
            throw new Error("B2B should not be called for offramp.");
          },
          initiateB2C: async () => ({
            ok: true,
            status: 200,
            data: {
              ResponseCode: "0",
              ResponseDescription: "Accepted for processing.",
              ConversationID: "AG_20260319_002",
              OriginatorConversationID: quoted.transaction.transactionId,
            },
          }),
        },
      }
    );

    const firstCallback = await processB2cResultWebhook(
      {
        transactionId: quoted.transaction.transactionId,
        payload: {
          Result: {
            ConversationID: "AG_20260319_002",
            OriginatorConversationID: quoted.transaction.transactionId,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            ResultParameters: {
              ResultParameter: [
                {
                  Key: "TransactionReceipt",
                  Value: "RCP123456",
                },
              ],
            },
          },
        },
      },
      { filePath: workspace.transactionFilePath }
    );

    assert.ok(firstCallback);
    assert.equal(firstCallback.status, "succeeded");
    assert.equal(firstCallback.daraja.receiptNumber, "RCP123456");

    const afterFirst = await getTransactionById(quoted.transaction.transactionId, {
      filePath: workspace.transactionFilePath,
    });
    assert.ok(afterFirst);
    assert.equal(afterFirst.status, "succeeded");
    const firstHistoryLength = afterFirst.history.length;

    await processB2cResultWebhook(
      {
        transactionId: quoted.transaction.transactionId,
        payload: {
          Result: {
            ConversationID: "AG_20260319_002",
            OriginatorConversationID: quoted.transaction.transactionId,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            ResultParameters: {
              ResultParameter: [
                {
                  Key: "TransactionReceipt",
                  Value: "RCP123456",
                },
              ],
            },
          },
        },
      },
      { filePath: workspace.transactionFilePath }
    );

    const afterSecond = await getTransactionById(quoted.transaction.transactionId, {
      filePath: workspace.transactionFilePath,
    });
    assert.ok(afterSecond);
    assert.equal(afterSecond.status, "succeeded");
    assert.equal(afterSecond.history.length, firstHistoryLength);
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("processB2bResultWebhook marks merchant payments as failed when Daraja reports an error", async () => {
  const workspace = await createWorkspace("dotpaymini-b2b-callback");
  const address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const fundingHash = makeTxHash("c");

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "paybill",
        amount: 500,
        currency: "KES",
        phoneNumber: "254700000005",
        paybillNumber: "600000",
        accountReference: "INV-500",
      },
      { filePath: workspace.transactionFilePath }
    );

    await initiateMpesaFlow(
      {
        transactionId: quoted.transaction.transactionId,
        userAddress: address,
        flowType: "paybill",
        pin: "123456",
        idempotencyKey: "paybill:1",
        onchainTxHash: fundingHash,
      },
      {
        filePath: workspace.transactionFilePath,
        userStoreFilePath: workspace.userFilePath,
        fundingVerifier: async () => buildVerifiedFunding(address, fundingHash),
        mpesaClient: {
          initiateB2C: async () => {
            throw new Error("B2C should not be called for paybill.");
          },
          initiateB2B: async (payload) => {
            assert.equal(payload.receiverNumber, "600000");
            assert.equal(payload.accountReference, "INV-500");
            return {
              ok: true,
              status: 200,
              data: {
                ResponseCode: "0",
                ResponseDescription: "Accepted for processing.",
                ConversationID: "BG_20260319_001",
                OriginatorConversationID: quoted.transaction.transactionId,
              },
            };
          },
        },
      }
    );

    const callback = await processB2bResultWebhook(
      {
        transactionId: quoted.transaction.transactionId,
        payload: {
          Result: {
            ConversationID: "BG_20260319_001",
            OriginatorConversationID: quoted.transaction.transactionId,
            ResultCode: "2001",
            ResultDesc: "The initiator information is invalid.",
          },
        },
      },
      { filePath: workspace.transactionFilePath }
    );

    assert.ok(callback);
    assert.equal(callback.status, "failed");
    assert.equal(callback.daraja.resultCodeRaw, "2001");
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("initiateMpesaFlow persists funding verification errors without simulating completion", async () => {
  const workspace = await createWorkspace("dotpaymini-funding-error");
  const address = "0xdddddddddddddddddddddddddddddddddddddddd";
  const fundingHash = makeTxHash("d");

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "buygoods",
        amount: 500,
        currency: "KES",
        tillNumber: "300584",
        accountReference: "SHOP-1",
      },
      { filePath: workspace.transactionFilePath }
    );

    await assert.rejects(
      () =>
        initiateMpesaFlow(
          {
            transactionId: quoted.transaction.transactionId,
            userAddress: address,
            flowType: "buygoods",
            pin: "123456",
            idempotencyKey: "buygoods:1",
            onchainTxHash: fundingHash,
          },
          {
            filePath: workspace.transactionFilePath,
            userStoreFilePath: workspace.userFilePath,
            fundingVerifier: async () => {
              throw new Error("Funding transaction receipt not found yet.");
            },
            mpesaClient: {
              initiateB2B: async () => {
                throw new Error("Daraja submission should not run when funding verification fails.");
              },
              initiateB2C: async () => {
                throw new Error("Daraja submission should not run when funding verification fails.");
              },
            },
          }
        ),
      /Funding transaction receipt not found yet/
    );

    const loaded = await getTransactionById(quoted.transaction.transactionId, {
      filePath: workspace.transactionFilePath,
    });
    assert.ok(loaded);
    assert.equal(loaded.status, "awaiting_onchain_funding");
    assert.equal(loaded.onchain.verificationStatus, "failed");
    assert.equal(loaded.onchain.txHash, fundingHash);
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("initiateMpesaFlow rejects an invalid PIN", async () => {
  const workspace = await createWorkspace("dotpaymini-mpesa-pin");
  const address = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "buygoods",
        amount: 500,
        currency: "KES",
        tillNumber: "300584",
        accountReference: "SHOP-1",
      },
      { filePath: workspace.transactionFilePath }
    );

    await assert.rejects(
      () =>
        initiateMpesaFlow(
          {
            transactionId: quoted.transaction.transactionId,
            userAddress: address,
            flowType: "buygoods",
            pin: "000000",
            idempotencyKey: "buygoods:2",
            onchainTxHash: makeTxHash("e"),
          },
          {
            filePath: workspace.transactionFilePath,
            userStoreFilePath: workspace.userFilePath,
          }
        ),
      /Invalid PIN/
    );
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("initiateOnrampStk stores accepted STK details on a quoted top-up intent", async () => {
  const workspace = await createWorkspace("dotpaymini-onramp-initiate");
  const address = "0xffffffffffffffffffffffffffffffffffffffff";

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "onramp",
        amount: 1500,
        currency: "KES",
        phoneNumber: "254700000007",
      },
      { filePath: workspace.transactionFilePath }
    );

    const initiated = await initiateOnrampStk(
      {
        transactionId: quoted.transaction.transactionId,
        userAddress: address,
        phoneNumber: "254700000007",
        idempotencyKey: "onramp:1",
      },
      {
        filePath: workspace.transactionFilePath,
        mpesaClient: {
          initiateStkPush: async (payload) => {
            assert.equal(payload.phoneNumber, "254700000007");
            assert.equal(payload.amountKes, quoted.transaction.quote.amountKes);
            return {
              ok: true,
              status: 200,
              data: {
                ResponseCode: "0",
                ResponseDescription: "Success. Request accepted for processing",
                CheckoutRequestID: "ws_CO_12345",
                MerchantRequestID: "29115-34620561-1",
                CustomerMessage: "Success. Request accepted for processing",
              },
            };
          },
        },
      }
    );

    assert.equal(initiated.status, "mpesa_processing");
    assert.equal(initiated.daraja.checkoutRequestId, "ws_CO_12345");
    assert.equal(initiated.daraja.merchantRequestId, "29115-34620561-1");
    assert.equal(initiated.daraja.responseCode, "0");
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});

test("processStkWebhook settles the wallet after a successful STK callback", async () => {
  const workspace = await createWorkspace("dotpaymini-onramp-callback");
  const address = "0x1212121212121212121212121212121212121212";

  try {
    await seedUser(workspace.userFilePath, address);

    const quoted = await createQuotedTransaction(
      {
        userAddress: address,
        flowType: "onramp",
        amount: 2200,
        currency: "KES",
        phoneNumber: "254700000008",
      },
      { filePath: workspace.transactionFilePath }
    );

    await initiateOnrampStk(
      {
        transactionId: quoted.transaction.transactionId,
        userAddress: address,
        phoneNumber: "254700000008",
        idempotencyKey: "onramp:2",
      },
      {
        filePath: workspace.transactionFilePath,
        mpesaClient: {
          initiateStkPush: async () => ({
            ok: true,
            status: 200,
            data: {
              ResponseCode: "0",
              ResponseDescription: "Accepted",
              CheckoutRequestID: "ws_CO_67890",
              MerchantRequestID: "29115-34620561-2",
            },
          }),
        },
      }
    );

    const settled = await processStkWebhook(
      {
        transactionId: quoted.transaction.transactionId,
        payload: {
          Body: {
            stkCallback: {
              MerchantRequestID: "29115-34620561-2",
              CheckoutRequestID: "ws_CO_67890",
              ResultCode: 0,
              ResultDesc: "The service request is processed successfully.",
              CallbackMetadata: {
                Item: [
                  {
                    Name: "MpesaReceiptNumber",
                    Value: "STK123456",
                  },
                ],
              },
            },
          },
        },
      },
      {
        filePath: workspace.transactionFilePath,
        settlementService: {
          settleOnrampToUserWallet: async (transaction) => {
            transaction.onchain = {
              ...transaction.onchain,
              required: false,
              txHash: makeTxHash("f"),
              chainId: 84532,
              tokenAddress: "0x1111111111111111111111111111111111111111",
              tokenSymbol: "USDC",
              treasuryAddress: "0x9999999999999999999999999999999999999999",
              expectedAmountUsd: transaction.quote.amountUsd,
              expectedAmountUnits: "16923077",
              fundedAmountUsd: transaction.quote.amountUsd,
              fundedAmountUnits: "16923077",
              fromAddress: "0x9999999999999999999999999999999999999999",
              toAddress: address,
              logIndex: null,
              verificationStatus: "verified",
              verificationError: null,
              verifiedBy: "treasury_settlement",
              verifiedAt: new Date().toISOString(),
            };

            return {
              txHash: makeTxHash("f"),
            };
          },
        },
      }
    );

    assert.ok(settled);
    assert.equal(settled.status, "succeeded");
    assert.equal(settled.daraja.receiptNumber, "STK123456");
    assert.equal(settled.onchain.txHash, makeTxHash("f"));
    assert.equal(settled.onchain.verificationStatus, "verified");
  } finally {
    await rm(workspace.tempDirPath, { recursive: true, force: true });
  }
});
