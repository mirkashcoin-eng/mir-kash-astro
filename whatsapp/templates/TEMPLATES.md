# WhatsApp message templates — submit these 5 to Meta for approval

Create each in **WhatsApp Manager → Templates → Create template**.

For all five:
- **Category:** Utility
- **Language:** English (US) → `en_US`
- **Name:** exactly as the heading (lowercase + underscores) — must match `template_map`.
- Add a **sample value** for every `{{n}}` when prompted.

> ⚠️ **Variable order matters** — it must match what the function sends. `#{{2}}` is the **bare order number**
> (e.g. `1001`), so don't add another `#`.

> The other 7 templates your coworker drafted (Delivery Update, Delivered, Delivery Failed, Order Delay, Pick-up,
> Action Needed, Return Confirmation, Welcome) are **not in Phase 1** — they need live courier tracking, are
> manual, or are the inbound bot (Phase 2). Hold those for now.

---

## 1) `order_confirmed`  (prepaid orders)
```
Hi {{1}}, your Mir Kash order is confirmed.
Order #{{2}} — {{3}}

We're getting it ready with care. You'll hear from us again the moment it ships.
```
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | First name | Priya |
| {{2}} | Order number | 1001 |
| {{3}} | Order total | ₹4,990 |

---

## 2) `cod_confirmation`  (Cash-on-Delivery orders)
```
Hi {{1}}, we've received your Cash-on-Delivery order #{{2}} ({{3}}).

To confirm, reply YES. If you didn't place this order, reply NO.
```
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | First name | Priya |
| {{2}} | Order number | 1001 |
| {{3}} | Order total | ₹4,990 |

> Replies aren't auto-handled until Phase 2 (the inbound bot); for now they land in your inbox for the team.

---

## 3) `order_shipped`  (order fulfilled)
```
Good news, {{1}} — your order is on its way.
Order #{{2}} has shipped and should arrive within 5–7 business days.

Track it here: {{3}}
```
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | First name | Priya |
| {{2}} | Order number | 1001 |
| {{3}} | Tracking link | https://mirkash.in/orders/track |

> The tracking link comes from Shopify's fulfillment tracking; if there's none, it falls back to the order's
> status page, so {{3}} is never empty.

---

## 4) `order_cancelled`  (order cancelled)
```
Hi {{1}}, order #{{2}} has been cancelled.
Reason: {{3}}

If you paid online, your refund will reflect within {{4}} business days.
```
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | First name | Priya |
| {{2}} | Order number | 1001 |
| {{3}} | Reason (friendly text) | cancelled at your request |
| {{4}} | Refund days | 5–7 |

> {{3}} is mapped from Shopify's `cancel_reason` to plain language (e.g. customer → "cancelled at your request").

---

## 5) `refund_processed`  (refund created)
```
Hi {{1}}, your refund for order #{{2}} of {{3}} has been processed.

It should reflect in your account within {{4}} business days.
```
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | First name | Priya |
| {{2}} | Order number | 1001 |
| {{3}} | Refund amount | ₹4,990 |
| {{4}} | Refund days | 5–7 |

> The refund webhook doesn't carry the phone/order number, so the function looks them up via the India Admin API
> (needs the optional `SHOPIFY_IN_ADMIN_*` secrets — see README step 3). Without them, refund messages are skipped
> and the other 4 still work.

---

## After approval
The template **names** above already match `seed.example.sql`. If Meta makes you rename one, update the matching
row in `template_map` (`template_name`) so the function points at the approved name.
