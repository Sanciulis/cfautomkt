-- Adds LGPD consent controls for marketing communications.

ALTER TABLE users ADD COLUMN marketing_opt_in INTEGER DEFAULT 1 CHECK (marketing_opt_in IN (0, 1));
ALTER TABLE users ADD COLUMN opt_out_at TIMESTAMP;
ALTER TABLE users ADD COLUMN consent_source TEXT DEFAULT 'unknown';
ALTER TABLE users ADD COLUMN consent_updated_at TIMESTAMP;

UPDATE users
SET marketing_opt_in = 1
WHERE marketing_opt_in IS NULL;

UPDATE users
SET consent_source = COALESCE(consent_source, 'legacy_migration')
WHERE consent_source IS NULL;

UPDATE users
SET consent_updated_at = COALESCE(consent_updated_at, CURRENT_TIMESTAMP)
WHERE consent_updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_marketing_opt_in ON users(marketing_opt_in);
