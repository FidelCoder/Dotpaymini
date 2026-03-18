const express = require("express");
const { requireInternalKey } = require("../middleware/requireInternalKey");
const {
  createQuotedTransaction,
  getTransactionById,
  listTransactions,
} = require("../services/transactionStore");

const router = express.Router();
router.use(requireInternalKey);

router.post("/quotes", async (req, res) => {
  try {
    const result = await createQuotedTransaction(req.body || {});
    return res.status(200).json({
      success: true,
      data: result,
      idempotent: result.idempotent,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create quote.",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const transactions = await listTransactions({
      userAddress: req.query.userAddress,
      flowType: req.query.flowType,
      status: req.query.status,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      data: {
        transactions,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to list transactions.",
    });
  }
});

router.get("/:transactionId", async (req, res) => {
  try {
    const transaction = await getTransactionById(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to load transaction.",
    });
  }
});

module.exports = { transactionsRouter: router };
