-- Migration: Add freezing rules tables
-- Date: 2026-04-01

CREATE TABLE IF NOT EXISTS freezing_rules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('user_freeze', 'campaign_freeze', 'segment_freeze')),
  name TEXT NOT NULL,
  description TEXT,
  conditions TEXT NOT NULL, -- JSON array of FreezingCondition
  actions TEXT NOT NULL, -- JSON array of FreezingAction
  enabled INTEGER DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient rule evaluation
CREATE INDEX IF NOT EXISTS idx_freezing_rules_type_enabled ON freezing_rules(type, enabled);
CREATE INDEX IF NOT EXISTS idx_freezing_rules_priority ON freezing_rules(priority DESC);