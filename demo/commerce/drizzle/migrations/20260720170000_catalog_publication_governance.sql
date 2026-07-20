ALTER TABLE catalog_shopify_mirrors
  ADD COLUMN IF NOT EXISTS desired_fingerprint text,
  ADD COLUMN IF NOT EXISTS published_fingerprint text,
  ADD COLUMN IF NOT EXISTS desired_revision bigint,
  ADD COLUMN IF NOT EXISTS published_revision bigint,
  ADD COLUMN IF NOT EXISTS retirement_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'never'
    CHECK (publication_status IN ('never', 'pending', 'synced', 'failed', 'conflict', 'retired')),
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS catalog_shopify_mirrors_publication_status_idx
  ON catalog_shopify_mirrors (publication_status, updated_at);

CREATE INDEX IF NOT EXISTS catalog_shopify_mirrors_active_claim_idx
  ON catalog_shopify_mirrors (claim_expires_at)
  WHERE claim_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_publication_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO catalog_publication_state (singleton, revision)
VALUES (true, 0)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS catalog_publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_key text NOT NULL,
  target text NOT NULL CHECK (target = 'shopify-production'),
  publication_id text NOT NULL,
  desired_fingerprint text NOT NULL,
  desired_revision bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'published', 'failed', 'conflict', 'superseded')),
  provider_collection_id text,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_publication_attempts_sync_key_started_idx
  ON catalog_publication_attempts (sync_key, started_at DESC);
