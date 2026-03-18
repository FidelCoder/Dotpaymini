const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");
const { mkdir, rm } = require("fs/promises");

const {
  createQuotedTransaction,
  getTransactionById,
  initiateMpesaTransaction,
  listTransactions,
  transitionTransaction,
} = require("../src/services/transactionStore");
const { setUserPin, upsertSessionUser } = require("../src/services/userStore");

test("createQuotedTransaction creates a quoted transaction intent and supports idempotency", async () => {
  const tempDirPath = path.join(os.tmpdir(), `dotpaymini-transactions-${Date.now()}`);
  await mkdir(tempDirPath, { recursive: true });
  const filePath = path.join(tempDirPath, "transactions.json");

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
      { filePath }
    );

    assert.equal(first.transaction.status, "quoted");
    assert.equal(first.transaction.targets.phoneNumber, "254700000001");
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
      { filePath }
    );

    assert.equal(second.idempotent, true);
    assert.equal(second.transaction.transactionId, first.transaction.transactionId);

    const loaded = await getTransactionById(first.transaction.transactionId, { filePath });
    assert.ok(loaded);
    assert.equal(loaded.status, "quoted");

    const listed = await listTransactions({ userAddress: "0x1234567890abcdef1234567890abcdef12345678" }, { filePath });
    assert.equal(listed.length, 1);
  } finally {
    await rm(tempDirPath, { recursive: true, force: true });
  }
});

test("transitionTransaction enforces the transaction state machine", async () => {
  const tempDirPath = path.join(os.tmpdir(), `dotpaymini-state-machine-${Date.now()}`);
  await mkdir(tempDirPath, { recursive: true });
  const filePath = path.join(tempDirPath, "transactions.json");

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
      { filePath }
    );

    const awaitingAuth = await transitionTransaction(
      created.transaction.transactionId,
      "awaiting_user_authorization",
      "Waiting for user confirmation.",
      "test",
      { filePath }
    );
    assert.equal(awaitingAuth.status, "awaiting_user_authorization");

    await assert.rejects(
      () =>
        transitionTransaction(
          created.transaction.transactionId,
          "refunded",
          "Skipping ahead should fail.",
          "test",
          { filePath }
        ),
      /Invalid status transition/
    );
  } finally {
    await rm(tempDirPath, { recursive: true, force: true });
  }
});

test("initiateMpesaTransaction verifies PIN and resolves simulated processing to succeeded", async () => {
  const tempDirPath = path.join(os.tmpdir(), `dotpaymini-mpesa-initiate-${Date.now()}`);
  await mkdir(tempDirPath, { recursive: true });
  const transactionFilePath = path.join(tempDirPath, "transactions.json");
  const userFilePath = path.join(tempDirPath, "users.json");

  try {
    await upsertSessionUser(
      {
        address: "0xcccccccccccccccccccccccccccccccccccccccc",
        usernameHint: "@tester",
      },
      { filePath: userFilePath }
    );
    await setUserPin("0xcccccccccccccccccccccccccccccccccccccccc", "123456", null, {
      filePath: userFilePath,
    });

    const quoted = await createQuotedTransaction(
      {
        userAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        flowType: "offramp",
        amount: 1000,
        currency: "KES",
        phoneNumber: "254700000003",
      },
      { filePath: transactionFilePath }
    );

    const initiated = await initiateMpesaTransaction(
      {
        transactionId: quoted.transaction.transactionId,
        userAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
        flowType: "offramp",
        pin: "123456",
      },
      {
        filePath: transactionFilePath,
        userStoreFilePath: userFilePath,
        simulationDelayMs: 5,
      }
    );

    assert.equal(initiated.status, "mpesa_processing");
    assert.equal(initiated.authorization.pinProvided, true);
    assert.equal(initiated.daraja.responseCode, "0");

    await sleep(10);
    const resolved = await getTransactionById(quoted.transaction.transactionId, {
      filePath: transactionFilePath,
    });

    assert.ok(resolved);
    assert.equal(resolved.status, "succeeded");
    assert.equal(resolved.daraja.resultCode, 0);
    assert.ok(resolved.daraja.receiptNumber);
  } finally {
    await rm(tempDirPath, { recursive: true, force: true });
  }
});

test("initiateMpesaTransaction rejects an invalid PIN", async () => {
  const tempDirPath = path.join(os.tmpdir(), `dotpaymini-mpesa-pin-${Date.now()}`);
  await mkdir(tempDirPath, { recursive: true });
  const transactionFilePath = path.join(tempDirPath, "transactions.json");
  const userFilePath = path.join(tempDirPath, "users.json");

  try {
    await upsertSessionUser(
      {
        address: "0xdddddddddddddddddddddddddddddddddddddddd",
        usernameHint: "@tester2",
      },
      { filePath: userFilePath }
    );
    await setUserPin("0xdddddddddddddddddddddddddddddddddddddddd", "123456", null, {
      filePath: userFilePath,
    });

    const quoted = await createQuotedTransaction(
      {
        userAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
        flowType: "buygoods",
        amount: 500,
        currency: "KES",
        tillNumber: "300584",
        accountReference: "SHOP-1",
      },
      { filePath: transactionFilePath }
    );

    await assert.rejects(
      () =>
        initiateMpesaTransaction(
          {
            transactionId: quoted.transaction.transactionId,
            userAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
            flowType: "buygoods",
            pin: "000000",
          },
          {
            filePath: transactionFilePath,
            userStoreFilePath: userFilePath,
          }
        ),
      /Invalid PIN/
    );
  } finally {
    await rm(tempDirPath, { recursive: true, force: true });
  }
});
