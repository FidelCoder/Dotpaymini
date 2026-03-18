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
