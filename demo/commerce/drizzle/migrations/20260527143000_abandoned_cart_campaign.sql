CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "abandoned_cart_cases" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cart_id" TEXT NOT NULL,
  "contact_id" TEXT,
  "email" TEXT NOT NULL,
  "cart_token" TEXT,
  "checkout_token" TEXT,
  "case_type" TEXT NOT NULL CHECK ("case_type" IN ('cart_abandoned', 'checkout_abandoned', 'payment_help')),
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'recovered', 'closed_order_found', 'closed_unsubscribed', 'expired')),
  "stage_at_open" TEXT,
  "last_cart_action_at" TIMESTAMPTZ NOT NULL,
  "opened_at" TIMESTAMPTZ NOT NULL,
  "recovered_at" TIMESTAMPTZ,
  "recovered_order_id" TEXT,
  "recovered_amount" DOUBLE PRECISION,
  "recovered_source_message_id" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_cart_cases_cart_id_unique"
  ON "abandoned_cart_cases" ("cart_id");
CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_email_idx" ON "abandoned_cart_cases" ("email");
CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_case_type_idx" ON "abandoned_cart_cases" ("case_type");
CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_status_idx" ON "abandoned_cart_cases" ("status");
CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_last_cart_action_at_idx" ON "abandoned_cart_cases" ("last_cart_action_at");
CREATE INDEX IF NOT EXISTS "abandoned_cart_cases_recovered_at_idx" ON "abandoned_cart_cases" ("recovered_at");

CREATE TABLE IF NOT EXISTS "abandoned_cart_messages" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "case_id" TEXT NOT NULL,
  "cart_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "message_type" TEXT NOT NULL CHECK (
    "message_type" IN ('abandoned_cart_1', 'abandoned_cart_2', 'abandoned_cart_3', 'payment_help_1', 'klaviyo_abandoned')
  ),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'sent', 'skipped', 'failed')),
  "scheduled_for" TIMESTAMPTZ NOT NULL,
  "sent_at" TIMESTAMPTZ,
  "provider" TEXT,
  "provider_message_id" TEXT,
  "template_key" TEXT,
  "locale" TEXT,
  "subject" TEXT,
  "idempotency_key" TEXT,
  "skip_reason" TEXT CHECK (
    "skip_reason" IS NULL OR "skip_reason" IN (
      'shopify_order_found',
      'klaviyo_email_found',
      'opt_out',
      'missing_email',
      'no_products',
      'already_recovered',
      'shopify_check_unavailable',
      'send_error'
    )
  ),
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "abandoned_cart_messages_case_type_unique"
  ON "abandoned_cart_messages" ("case_id", "message_type");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_cart_id_idx" ON "abandoned_cart_messages" ("cart_id");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_email_idx" ON "abandoned_cart_messages" ("email");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_status_idx" ON "abandoned_cart_messages" ("status");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_message_type_idx" ON "abandoned_cart_messages" ("message_type");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_scheduled_for_idx" ON "abandoned_cart_messages" ("scheduled_for");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_sent_at_idx" ON "abandoned_cart_messages" ("sent_at");
CREATE INDEX IF NOT EXISTS "abandoned_cart_messages_skip_reason_idx" ON "abandoned_cart_messages" ("skip_reason");

CREATE TABLE IF NOT EXISTS "abandoned_cart_checks" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "case_id" TEXT NOT NULL,
  "message_id" TEXT,
  "check_type" TEXT NOT NULL CHECK ("check_type" IN ('shopify_order', 'klaviyo_email', 'opt_out')),
  "status" TEXT NOT NULL CHECK ("status" IN ('passed', 'blocked', 'error', 'unknown')),
  "raw_summary" TEXT,
  "checked_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "abandoned_cart_checks_case_id_idx" ON "abandoned_cart_checks" ("case_id");
CREATE INDEX IF NOT EXISTS "abandoned_cart_checks_message_id_idx" ON "abandoned_cart_checks" ("message_id");
CREATE INDEX IF NOT EXISTS "abandoned_cart_checks_check_type_idx" ON "abandoned_cart_checks" ("check_type");
CREATE INDEX IF NOT EXISTS "abandoned_cart_checks_status_idx" ON "abandoned_cart_checks" ("status");
CREATE INDEX IF NOT EXISTS "abandoned_cart_checks_checked_at_idx" ON "abandoned_cart_checks" ("checked_at");

INSERT INTO "abandoned_cart_cases" (
  "cart_id",
  "contact_id",
  "email",
  "cart_token",
  "checkout_token",
  "case_type",
  "status",
  "stage_at_open",
  "last_cart_action_at",
  "opened_at",
  "created_at",
  "updated_at"
)
SELECT
  c.id,
  ct.id,
  LOWER(c.email),
  c.cart_token,
  c.checkout_token,
  CASE
    WHEN c.highest_stage = 'payment_attempted' THEN 'payment_help'
    WHEN c.highest_stage IN ('checkout_started', 'checkout_engaged') THEN 'checkout_abandoned'
    ELSE 'cart_abandoned'
  END,
  'open',
  c.highest_stage,
  c.last_action_at,
  COALESCE(c.abandon_notified_at, c.last_action_at),
  NOW(),
  NOW()
FROM carts c
LEFT JOIN contacts ct ON LOWER(ct.email) = LOWER(c.email)
WHERE c.email IS NOT NULL
  AND COALESCE(c.abandon_notified_count, 0) > 0
ON CONFLICT ("cart_id") DO UPDATE SET
  "contact_id" = COALESCE(EXCLUDED."contact_id", "abandoned_cart_cases"."contact_id"),
  "email" = EXCLUDED."email",
  "cart_token" = EXCLUDED."cart_token",
  "checkout_token" = EXCLUDED."checkout_token",
  "last_cart_action_at" = EXCLUDED."last_cart_action_at",
  "updated_at" = NOW();

INSERT INTO "abandoned_cart_messages" (
  "case_id",
  "cart_id",
  "email",
  "message_type",
  "status",
  "scheduled_for",
  "sent_at",
  "provider",
  "template_key",
  "created_at",
  "updated_at"
)
SELECT
  acc.id,
  c.id,
  LOWER(c.email),
  CASE WHEN c.abandon_notified_source = 'klaviyo' THEN 'klaviyo_abandoned' ELSE 'abandoned_cart_1' END,
  'sent',
  c.abandon_notified_at,
  c.abandon_notified_at,
  COALESCE(c.abandon_notified_source, 'manta_legacy'),
  CASE WHEN c.abandon_notified_source = 'klaviyo' THEN 'klaviyo_abandoned' ELSE 'abandoned_cart' END,
  NOW(),
  NOW()
FROM carts c
JOIN abandoned_cart_cases acc ON acc.cart_id = c.id
WHERE c.email IS NOT NULL
  AND c.abandon_notified_at IS NOT NULL
  AND COALESCE(c.abandon_notified_count, 0) > 0
ON CONFLICT ("case_id", "message_type") DO NOTHING;

WITH recovered AS (
  SELECT DISTINCT ON (acc.id)
    acc.id AS case_id,
    m.id AS message_id,
    o.shopify_order_id,
    o.placed_at,
    o.total_price
  FROM abandoned_cart_cases acc
  JOIN abandoned_cart_messages m ON m.case_id = acc.id AND m.status = 'sent' AND m.sent_at IS NOT NULL
  JOIN orders o
    ON LOWER(o.email) = LOWER(acc.email)
   AND o.placed_at > m.sent_at
   AND o.placed_at <= m.sent_at + INTERVAL '7 days'
   AND o.status IN ('paid', 'fulfilled')
  WHERE acc.status = 'open'
  ORDER BY acc.id, o.placed_at ASC, m.sent_at DESC
)
UPDATE abandoned_cart_cases acc
SET status = 'recovered',
    recovered_at = recovered.placed_at,
    recovered_order_id = recovered.shopify_order_id,
    recovered_amount = recovered.total_price,
    recovered_source_message_id = recovered.message_id,
    updated_at = NOW()
FROM recovered
WHERE acc.id = recovered.case_id;
