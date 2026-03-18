# Reference Rules

## Source Systems

- Product parity source: `DotPayFE` and `DotPayBE` in the parent workspace
- Current frontend reference flows:
  - `DotPayFE/app/send/page.tsx`
  - `DotPayFE/components/mpesa/MpesaSendModePage.tsx`
  - `DotPayFE/app/pay/page.tsx`
  - `DotPayFE/app/add-funds/page.tsx`
- Current backend reference flows:
  - `DotPayBE/src/routes/mpesa.js`
  - `DotPayBE/src/routes/users.js`
  - `DotPayBE/src/services/settlement/verifyUsdcFunding.js`

## Official World References

- Getting started: https://docs.world.org/mini-apps/quick-start/installing
- Initialization: https://docs.world.org/mini-apps/quick-start/init
- Wallet Auth: https://docs.world.org/mini-apps/commands/wallet-auth
- Pay: https://docs.world.org/mini-apps/commands/pay
- App guidelines: https://docs.world.org/mini-apps/guidelines/app-guidelines
- FAQ: https://docs.world.org/mini-apps/more/faq

## Build Rules

- Keep a single monorepo with separate `apps/web` and `apps/api`.
- Backend remains the source of truth for user records, quotes, transaction state, M-Pesa callbacks, and payment verification.
- Frontend uses World Mini App primitives for auth and payment initiation.
- Every Wallet Auth or Pay payload must be verified on a trusted server boundary.

## UX Rules

- Design for mobile first.
- Use bottom tab navigation, short sections, and anchored calls to action.
- Prefer World usernames over raw wallet addresses in the UI when available.
- Do not use the word `official` in branding or copy.
- Do not use the World logo in the product UI.

## Security Rules

- Never commit secrets.
- Keep private keys server-side only.
- Use `.env.example` placeholders and document required values.
- Treat all frontend payloads as untrusted until verified.

## Chain Rules

- Abstract chain settings behind env vars and config helpers.
- Keep a clear split between:
  - local or mocked development
  - test-safe backend logic
  - World Mini App mainnet QA
- Current World docs state that mini app transaction development does not support testnet, so plan final in-app flow verification on mainnet.
