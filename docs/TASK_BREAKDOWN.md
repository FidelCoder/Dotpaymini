# Task Breakdown

## Phase 1: Foundation

- Set up one monorepo with `apps/web` and `apps/api`
- Add project rules, env templates, and product parity docs
- Ship a mobile-first app shell with bottom navigation
- Implement Wallet Auth nonce generation and SIWE verification

Acceptance:

- repo installs with one command
- web and api run locally
- World Mini App can trigger Wallet Auth and create a verified local session

## Phase 2: Identity And User Model

- Port DotPay user creation and lookup concepts into the new backend
- Map World wallet address and username to DotPay profile records
- Add onboarding state, PIN state, and profile completion state
- Define internal auth between web and API

Acceptance:

- authenticated World user can create or resume a DotPaymini profile
- user session can resolve username, wallet, and onboarding status

Current progress:

- backend profile sync is now in place for Wallet Auth sessions
- stable DotPay IDs are created when a user first signs in
- PIN setup, confirmation name, and onboarding completion state are now wired
- internal auth between web server routes and the API is now in place

## Phase 3: Core Money Movement Parity

- Port `Send` flow for direct wallet transfer parity
- Port M-Pesa cashout flow
- Port merchant payment flows:
  - PayBill
  - Buy Goods / Till
- Port `Add Funds` flow

Acceptance:

- backend can create quotes, store intents, and track state transitions
- frontend can complete happy-path send, pay, and add-funds flows against configured environments
- every chain-facing flow has backend verification

## Phase 4: Receipts, Activity, Notifications

- Port transaction history and detail views
- Port receipt and timeline states
- Port notifications and unread tracking
- Add operational views needed for support and reconciliation

Acceptance:

- user can see transaction history and transaction detail timeline
- backend stores receipt and callback metadata

## Phase 5: World Production Readiness

- Replace placeholder flows with World-native pay and transaction commands where appropriate
- Configure Developer Portal items:
  - app metadata
  - allowlisted addresses or contracts
  - notification settings
- Run mainnet QA for World Mini App transaction flows
- Prepare submission copy and review checklist

Acceptance:

- World App auth works on device
- in-app payment verification passes against live World infrastructure
- app is ready for review submission

## Immediate Next Build Slice

- port M-Pesa initiation routes for:
  - cashout
  - paybill
  - buygoods
- connect the new quote UI to initiation and transaction-detail polling
- start callback and receipt timeline handling
