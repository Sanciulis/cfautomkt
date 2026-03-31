CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  preferred_channel TEXT DEFAULT 'email',
  psychological_profile TEXT DEFAULT 'generic',
  engagement_score REAL DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  viral_points INTEGER DEFAULT 0,
  marketing_opt_in INTEGER DEFAULT 1 CHECK (marketing_opt_in IN (0, 1)),
  opt_out_at TIMESTAMP,
  consent_source TEXT DEFAULT 'unknown',
  consent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  campaign_id TEXT,
  channel TEXT DEFAULT 'whatsapp',
  event_type TEXT NOT NULL,
  metadata TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT NOT NULL,
  payload TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journey_enrollments (
  user_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  current_phase TEXT DEFAULT 'discovery',
  last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  conversation_history TEXT,
  metadata TEXT,
  PRIMARY KEY (user_id, journey_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (journey_id) REFERENCES journeys(id)
);

CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);
CREATE INDEX IF NOT EXISTS idx_users_marketing_opt_in ON users(marketing_opt_in);
CREATE INDEX IF NOT EXISTS idx_interactions_user_event ON interactions(user_id, event_type);
CREATE INDEX IF NOT EXISTS idx_interactions_campaign_event ON interactions(campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);
CREATE INDEX IF NOT EXISTS idx_journey_enrollments_phase ON journey_enrollments(journey_id, current_phase);
