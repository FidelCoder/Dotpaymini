# Product Parity Map

## Existing DotPay Surface

- Auth and onboarding
- Home dashboard
- Send
  - wallet send
  - DotPay ID lookup
  - email or phone based discovery
  - M-Pesa cashout
- Pay
  - PayBill
  - Till / Buy Goods
- Add Funds
  - STK push onramp
- Receive
- Activity and receipts
- Settings and PIN management
- Backend user store
- Backend notifications
- Backend M-Pesa quotes, callbacks, refunds, and reconciliation

## World Mini App Translation

- Auth:
  - replace wallet connection modal with World Wallet Auth
- Home:
  - keep dashboard and shortcuts, optimized for World Mini App mobile constraints
- Send:
  - preserve recipient, amount, review, and receipt stages
  - adapt chain execution to World primitives
- Pay:
  - preserve PayBill and Till settlement logic in backend
  - use World payment or transaction commands for wallet-side authorization
- Add Funds:
  - preserve backend M-Pesa onramp orchestration
  - adapt wallet settlement to World wallet rails
- Activity:
  - preserve backend transaction timeline and receipt model
- Settings:
  - preserve profile, security, and notification preferences

## Implementation Notes

- The new product should feel like the same DotPay product, not a separate experiment.
- Backend transaction state and M-Pesa orchestration can remain conceptually close to `DotPayBE`.
- Frontend wallet, auth, and payment initiation must be reworked for World Mini App capabilities.
