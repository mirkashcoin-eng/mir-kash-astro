# WhatsApp message templates — submit these to Meta for approval

Create each one in **WhatsApp Manager → Templates → Create template**.

For all three:
- **Category:** Utility
- **Language:** English (US) → `en_US`
- **Name:** exactly as shown below (lowercase + underscores) — it must match `template_map`.
- Add a **sample value** for every `{{n}}` when prompted (Meta requires samples to approve).

> ⚠️ The **variable order matters** — it must match what the function sends. Don't reorder the `{{n}}` slots.

---

## 1) `order_confirmed`  (prepaid orders)

**Body:**
```
Hi {{1}}, thank you for shopping with Mir Kash! 🤎

Your order {{2}} is confirmed.
Order total: {{3}}

We'll message you the moment it ships. Questions? Just reply here.
— Team Mir Kash
```

**Variables (in order):**
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | Customer first name | Priya |
| {{2}} | Order number | #1001 |
| {{3}} | Order total | ₹4,990 |

---

## 2) `cod_confirmation`  (Cash-on-Delivery orders)

**Body:**
```
Hi {{1}}, we've received your Cash-on-Delivery order {{2}} (total {{3}}).

To confirm, reply YES. If you didn't place this order, reply NO.
— Team Mir Kash
```

**Variables (in order):**
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | Customer first name | Priya |
| {{2}} | Order number | #1001 |
| {{3}} | Order total | ₹4,990 |

> Note for Phase 1: replies (YES/NO) are **not auto-processed yet** — that's Phase 2 (inbound bot). In Phase 1
> the reply simply lands in your WhatsApp inbox for the team to read. If you'd rather not ask for a reply until
> then, reword to: *"We'll dispatch it shortly. If anything's wrong, call us at <number>."*

---

## 3) `order_shipped`  (order fulfilled)

**Body:**
```
Hi {{1}}, great news — your Mir Kash order {{2}} has shipped! 📦

Courier: {{3}}
Track your order: {{4}}

Estimated delivery: 5–7 business days.
— Team Mir Kash
```

**Variables (in order):**
| Slot | Meaning | Sample |
|------|---------|--------|
| {{1}} | Customer first name | Priya |
| {{2}} | Order number | #1001 |
| {{3}} | Courier name | Delhivery |
| {{4}} | Tracking link | https://mirkash.in/orders/track |

> The tracking link comes from Shopify's fulfillment tracking; if a fulfillment has no tracking URL, the code
> falls back to the order's status page, so {{4}} is never empty (Meta rejects empty variables).

---

## After approval
The template **names** above already match `seed.example.sql`. If Meta makes you rename one, update the matching
row in `template_map` (`template_name`) so the function points at the approved name.
