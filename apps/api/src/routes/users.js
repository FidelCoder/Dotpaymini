const express = require("express");
const {
  findUserByAddress,
  getPinStatus,
  lookupRecipient,
  normalizeAddress,
  setProductIdentity,
  setUserPin,
  toPublicUser,
  upsertSessionUser,
  verifyUserPinForAddress,
} = require("../services/userStore");
const { requireInternalKey } = require("../middleware/requireInternalKey");

const router = express.Router();
router.use(requireInternalKey);

router.get("/lookup", async (req, res) => {
  try {
    const query =
      typeof req.query?.q === "string"
        ? req.query.q
        : typeof req.query?.query === "string"
          ? req.query.query
          : "";
    const result = await lookupRecipient(query);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to lookup recipient.",
    });
  }
});

router.post("/session", async (req, res) => {
  try {
    const user = await upsertSessionUser({
      address: req.body?.address,
      usernameHint: req.body?.usernameHint,
      profilePictureUrl: req.body?.profilePictureUrl,
      walletAuthVersion: req.body?.walletAuthVersion,
    });

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to sync user session.",
    });
  }
});

router.get("/:address", async (req, res) => {
  try {
    const address = normalizeAddress(req.params.address);
    const user = await findUserByAddress(address);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: toPublicUser(user),
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to load user.",
    });
  }
});

router.patch("/:address/profile", async (req, res) => {
  try {
    const address = normalizeAddress(req.params.address);
    const user = await setProductIdentity(address, req.body?.username);

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update profile.",
    });
  }
});

router.get("/:address/pin", async (req, res) => {
  try {
    const address = normalizeAddress(req.params.address);
    const status = await getPinStatus(address);

    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to load PIN status.",
    });
  }
});

router.patch("/:address/pin", async (req, res) => {
  try {
    const address = normalizeAddress(req.params.address);
    const user = await setUserPin(address, req.body?.pin, req.body?.oldPin);

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to set PIN.",
    });
  }
});

router.post("/:address/pin/verify", async (req, res) => {
  try {
    const address = normalizeAddress(req.params.address);
    const verified = await verifyUserPinForAddress(address, req.body?.pin);

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Invalid PIN.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        address,
        verified: true,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to verify PIN.",
    });
  }
});

module.exports = { usersRouter: router };
