-- One-time migration for legacy production DB created with the initial schema.

ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN psychological_profile TEXT DEFAULT 'generic';
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN viral_points INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE interactions ADD COLUMN campaign_id TEXT;
ALTER TABLE interactions ADD COLUMN channel TEXT DEFAULT 'whatsapp';
ALTER TABLE interactions ADD COLUMN metadata TEXT;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_copy TEXT NOT NULL,
  incentive_offer TEXT,
  channel TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT NOT NULL,
  payload TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

UPDATE users
SET referral_code = lower(substr(replace(id, '-', ''), 1, 8) || hex(randomblob(3)))
WHERE referral_code IS NULL;

UPDATE users
SET psychological_profile = 'generic'
WHERE psychological_profile IS NULL;

UPDATE users
SET viral_points = 0
WHERE viral_points IS NULL;

UPDATE users
SET created_at = COALESCE(created_at, last_active, CURRENT_TIMESTAMP)
WHERE created_at IS NULL;

UPDATE interactions
SET channel = 'whatsapp'
WHERE channel IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);
CREATE INDEX IF NOT EXISTS idx_interactions_user_event ON interactions(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_interactions_campaign_event ON interactions(campaign_id, event_type);
