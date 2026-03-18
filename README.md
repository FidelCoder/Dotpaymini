# Dotpaymini

World Mini App port of DotPay, built as one monorepo with:

- `apps/web`: the World Mini App frontend
- `apps/api`: the backend/API layer for product state, payment verification, and M-Pesa settlement

## Repo Strategy

We do not need a second repository.

The cleanest setup is one monorepo that keeps the frontend and backend as separate apps while sharing the same roadmap, env conventions, and deployment references. That gives us the product separation we already rely on in `DotPayFE` and `DotPayBE`, without the coordination overhead of two new repos.

## Why This Structure

- The current DotPay product is already logically split into UI and system-of-record API.
- World Mini Apps still require trusted backend verification for Wallet Auth and Pay flows.
- One repo lets us ship the new product in lockstep while still deploying the web app and API independently.

## Current Foundation

This repo now includes:

- a runnable Next.js World Mini App shell
- Wallet Auth nonce + SIWE verification routes
- backend-backed user profile sync with stable DotPay IDs
- product confirmation name and PIN setup
- transaction intent, quote creation, and status-transition foundations
- a minimal Express API service
- reference rules, parity mapping, and task breakdown docs

## Important World Constraint

As of March 18, 2026, the official World Mini Apps FAQ says transaction testing for mini apps is mainnet-only and that testnet is not supported for Mini App transaction development:

- https://docs.world.org/mini-apps/more/faq

That means we should still keep our config test-safe and use placeholders/local mocks where possible, but final end-to-end Mini App payment and transaction QA will need World Chain mainnet.

## Getting Started

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
# set the same DOTPAYMINI_INTERNAL_API_KEY value in both env files
npm run dev
```

Frontend:

- `http://localhost:3000`

API:

- `http://localhost:4000`

## Initial Deliverables

- World Mini App shell and navigation
- Wallet Auth foundation
- backend user profile foundation
- onboarding, confirmation name, and PIN foundation
- transaction intent and quote foundation
- backend scaffold for product APIs
- product parity map from current DotPay
- implementation rules and task breakdown

## Reference Docs

- [docs/REFERENCE_RULES.md](./docs/REFERENCE_RULES.md)
- [docs/TASK_BREAKDOWN.md](./docs/TASK_BREAKDOWN.md)
- [docs/PRODUCT_PARITY.md](./docs/PRODUCT_PARITY.md)
