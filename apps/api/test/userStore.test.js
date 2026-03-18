const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { mkdir, readFile, rm } = require("fs/promises");

const {
  findUserByAddress,
  setProductIdentity,
  setUserPin,
  upsertSessionUser,
  verifyUserPinForAddress,
} = require("../src/services/userStore");

test("upsertSessionUser creates and updates a backend-backed world wallet profile", async () => {
  const tempDirPath = path.join(os.tmpdir(), `dotpaymini-user-store-${Date.now()}`);
  await mkdir(tempDirPath, { recursive: true });
  const filePath = path.join(tempDirPath, "users.json");

  try {
    const created = await upsertSessionUser(
      {
        address: "0x1234567890abcdef1234567890abcdef12345678",
        usernameHint: "@Fidel_Coder",
        profilePictureUrl: "https://example.com/avatar.png",
        walletAuthVersion: 2,
      },
      { filePath }
    );

    assert.equal(created.address, "0x1234567890abcdef1234567890abcdef12345678");
    assert.match(created.dotpayId, /^DP\d{9}$/);
    assert.equal(created.worldUsername, "fidel_coder");
    assert.equal(created.username, null);
    assert.equal(created.profileStatus, "needs_pin");
    assert.equal(created.authMethod, "world_wallet");

    const updated = await upsertSessionUser(
      {
        address: "0x1234567890ABCDEF1234567890ABCDEF12345678",
        usernameHint: "@fidel_coder",
        profilePictureUrl: "https://example.com/avatar-2.png",
        walletAuthVersion: 3,
      },
      { filePath }
    );

    assert.equal(updated.id, created.id);
    assert.equal(updated.dotpayId, created.dotpayId);
    assert.equal(updated.profilePictureUrl, "https://example.com/avatar-2.png");

    const loaded = await findUserByAddress("0x1234567890abcdef1234567890abcdef12345678", { filePath });
    assert.ok(loaded);
    assert.equal(loaded.dotpayId, created.dotpayId);

    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
  } finally {
    await rm(tempDirPath, { recursive: true, force: true });
  }
});

test("setProductIdentity and setUserPin complete the onboarding state machine", async () => {
  const tempDirPath = path.join(os.tmpdir(), `dotpaymini-onboarding-${Date.now()}`);
  await mkdir(tempDirPath, { recursive: true });
  const filePath = path.join(tempDirPath, "users.json");

  try {
    const created = await upsertSessionUser(
      {
        address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        usernameHint: "@worldfidel",
      },
      { filePath }
    );

    assert.equal(created.profileStatus, "needs_pin");

    const afterPin = await setUserPin("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", "123456", null, { filePath });
    assert.equal(afterPin.pinSet, true);
    assert.equal(afterPin.profileStatus, "needs_profile");

    const afterIdentity = await setProductIdentity(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      "@fidelmini",
      { filePath }
    );
    assert.equal(afterIdentity.username, "fidelmini");
    assert.equal(afterIdentity.profileStatus, "active");
    assert.ok(afterIdentity.profileCompletedAt);

    const verified = await verifyUserPinForAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", "123456", {
      filePath,
    });
    assert.equal(verified, true);
  } finally {
    await rm(tempDirPath, { recursive: true, force: true });
  }
});
