# Move order messages to the website's WhatsApp number

Order messages (Supabase) sent from number ID `1162880016911789`; the website and inbox use
`1285100258018493` (WhatsApp account `1608333530921964`, "Mir Kash WA Support India"). Replies only
reach the inbox for numbers in the app whose webhook points at the website, so everything moves to
`1285100258018493`.

Templates already in that account (en, active): `order_confirmed`, `order_shipped` (2 variables),
`cart_reminder`. Supabase sends `order_shipped` with 3 variables (adds the tracking link) and asks for
language `en_US`, so:

| Supabase event_key | template to send | status |
|---|---|---|
| order_confirmed | `order_confirmed` | exists |
| cod_confirmation | `cod_confirmation` | **file it** |
| order_shipped | `order_shipped_v2` (3 variables) | **file it** |
| order_cancelled | `order_cancelled` | **file it** |
| refund_processed | `refund_processed` | **file it** |

## Steps
1. Deploy this branch to production.
2. File the four new templates: open
   `https://www.mirkash.com/api/admin/wa-setup?key=<CRON_SECRET>` once. Existing templates return "already exists".
   Wait for Meta to approve them (WhatsApp Manager → Message templates).
3. Supabase secret: `META_ACCESS_TOKEN` = the same token as `WHATSAPP_TOKEN` in Vercel (it must be allowed to
   send from `1285100258018493`):
   `supabase secrets set META_ACCESS_TOKEN=<token>`
4. Supabase SQL Editor, once the templates are approved:
```sql
update store_config set meta_phone_number_id = '1285100258018493'
 where store_domain = 'e8601g-8a.myshopify.com';

update template_map set language_code = 'en'
 where store_domain = 'e8601g-8a.myshopify.com';

update template_map set template_name = 'order_shipped_v2'
 where store_domain = 'e8601g-8a.myshopify.com' and event_key = 'order_shipped';
```
5. Test: a small order → one confirmation, from the new number; reply to it → appears in /admin/whatsapp.
