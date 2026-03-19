const express = require("express");
const cors = require("cors");
const { mpesaRouter } = require("./routes/mpesa");
const { mpesaWebhooksRouter } = require("./routes/mpesa-webhooks");
const { transactionsRouter } = require("./routes/transactions");
const { usersRouter } = require("./routes/users");

const app = express();

const allowedOrigins = String(process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      return cb(null, false);
    },
    credentials: true,
  })
);

app.use(express.json());

const capabilities = [
  {
    id: "wallet-auth",
    label: "Wallet Auth",
    status: "live",
    detail: "Nonce creation and SIWE verification are scaffolded in the web app.",
  },
  {
    id: "user-model",
    label: "User model",
    status: "live",
    detail: "Wallet Auth sessions now create or resume a backend Dotpaymini profile with a stable DotPay ID, product username, and PIN state.",
  },
  {
    id: "mpesa-engine",
    label: "M-Pesa engine",
    status: "live",
    detail: "Real Daraja submission, callback-driven status updates, and on-chain funding proof verification are wired for outbound M-Pesa flows.",
  },
  {
    id: "world-pay",
    label: "World pay QA",
    status: "blocked",
    detail: "Final in-app transaction testing is constrained by World mainnet-only mini app support.",
  },
];

app.get(["/", "/health", "/api/health"], (_req, res) => {
  res.json({
    ok: true,
    service: "dotpaymini-api",
    phase: "identity",
  });
});

app.get("/api/capabilities", (_req, res) => {
  res.json({
    success: true,
    capabilities,
  });
});

app.use("/api/users", usersRouter);
app.use("/api/mpesa", mpesaWebhooksRouter);
app.use("/api/mpesa", mpesaRouter);
app.use("/api/transactions", transactionsRouter);

app.get("/api/parity", (_req, res) => {
  res.json({
    success: true,
    sourceRepos: ["DotPayFE", "DotPayBE"],
    targetRepo: "Dotpaymini",
    strategy: "single-monorepo-two-apps",
    nextPort: "world-wallet-transfer-leg-and-stk-onramp",
  });
});

module.exports = { app };
