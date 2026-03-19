const express = require("express");
const { mpesaConfig } = require("../config/mpesa");
const {
  createWebhookAck,
  processStkWebhook,
  processB2bResultWebhook,
  processB2bTimeoutWebhook,
  processB2cResultWebhook,
  processB2cTimeoutWebhook,
} = require("../services/mpesaFlowService");

const router = express.Router();

router.use((req, res, next) => {
  const expectedSecret = String(mpesaConfig.callbacks.webhookSecret || "").trim();
  if (!expectedSecret) {
    return next();
  }

  const provided = String(req.query?.secret || req.get("x-mpesa-webhook-secret") || "").trim();
  if (!provided || provided !== expectedSecret) {
    return res.status(401).json({ ResultCode: 1, ResultDesc: "Unauthorized" });
  }

  return next();
});

router.post("/webhooks/stk", async (req, res) => {
  try {
    await processStkWebhook({
      payload: req.body,
      transactionId: req.query?.tx,
    });
  } catch (error) {
    console.error("STK webhook error:", error);
  }

  return res.status(200).json(createWebhookAck());
});

router.post("/webhooks/b2c/result", async (req, res) => {
  try {
    await processB2cResultWebhook({
      payload: req.body,
      transactionId: req.query?.tx,
    });
  } catch (error) {
    console.error("B2C result webhook error:", error);
  }

  return res.status(200).json(createWebhookAck());
});

router.post("/webhooks/b2c/timeout", async (req, res) => {
  try {
    await processB2cTimeoutWebhook({
      payload: req.body,
      transactionId: req.query?.tx,
    });
  } catch (error) {
    console.error("B2C timeout webhook error:", error);
  }

  return res.status(200).json(createWebhookAck());
});

router.post("/webhooks/b2b/result", async (req, res) => {
  try {
    await processB2bResultWebhook({
      payload: req.body,
      transactionId: req.query?.tx,
    });
  } catch (error) {
    console.error("B2B result webhook error:", error);
  }

  return res.status(200).json(createWebhookAck());
});

router.post("/webhooks/b2b/timeout", async (req, res) => {
  try {
    await processB2bTimeoutWebhook({
      payload: req.body,
      transactionId: req.query?.tx,
    });
  } catch (error) {
    console.error("B2B timeout webhook error:", error);
  }

  return res.status(200).json(createWebhookAck());
});

module.exports = { mpesaWebhooksRouter: router };
