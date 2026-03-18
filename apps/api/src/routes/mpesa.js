const express = require("express");
const { requireInternalKey } = require("../middleware/requireInternalKey");
const { initiateMpesaTransaction } = require("../services/transactionStore");

const router = express.Router();
router.use(requireInternalKey);

async function handleInitiation(req, res, flowType) {
  try {
    const transaction = await initiateMpesaTransaction({
      transactionId: req.body?.transactionId,
      userAddress: req.body?.userAddress,
      flowType,
      pin: req.body?.pin,
      signature: req.body?.signature,
      signedAt: req.body?.signedAt,
      nonce: req.body?.nonce,
    });

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to initiate M-Pesa transaction.",
    });
  }
}

router.post("/offramp/initiate", async (req, res) => handleInitiation(req, res, "offramp"));
router.post("/merchant/paybill/initiate", async (req, res) => handleInitiation(req, res, "paybill"));
router.post("/merchant/buygoods/initiate", async (req, res) => handleInitiation(req, res, "buygoods"));

module.exports = { mpesaRouter: router };
