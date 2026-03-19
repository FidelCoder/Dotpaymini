const express = require("express");
const { requireInternalKey } = require("../middleware/requireInternalKey");
const { initiateMpesaFlow, initiateOnrampStk } = require("../services/mpesaFlowService");

const router = express.Router();
router.use(requireInternalKey);

function getIdempotencyKey(req) {
  return String(req.get("idempotency-key") || req.body?.idempotencyKey || "").trim() || null;
}

async function handleInitiation(req, res, flowType) {
  try {
    const transaction = await initiateMpesaFlow({
      ...req.body,
      flowType,
      idempotencyKey: getIdempotencyKey(req),
      userAddress: req.body?.userAddress,
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

router.post("/onramp/stk/initiate", async (req, res) => {
  try {
    const transaction = await initiateOnrampStk({
      ...req.body,
      idempotencyKey: getIdempotencyKey(req),
      userAddress: req.body?.userAddress,
    });

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to initiate onramp.",
    });
  }
});

router.post("/offramp/initiate", async (req, res) => handleInitiation(req, res, "offramp"));
router.post("/merchant/paybill/initiate", async (req, res) => handleInitiation(req, res, "paybill"));
router.post("/merchant/buygoods/initiate", async (req, res) => handleInitiation(req, res, "buygoods"));

module.exports = { mpesaRouter: router };
