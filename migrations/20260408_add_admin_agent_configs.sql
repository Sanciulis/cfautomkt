-- Migration: Add admin agent configuration registry
-- Date: 20260408
-- Description: Adds generic agent config table for admin create/edit/toggle flows.

CREATE TABLE IF NOT EXISTS admin_agent_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'whatsapp', 'email', 'custom')),
  description TEXT,
  inbound_webhook_url TEXT,
  dispatch_webhook_url TEXT,
  test_contact TEXT,
  test_message TEXT,
  conversation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (conversation_enabled IN (0, 1)),
  ai_model TEXT NOT NULL DEFAULT '@cf/meta/llama-3-8b-instruct',
  max_reply_chars INTEGER NOT NULL DEFAULT 320,
  prompt_target_id TEXT,
  system_prompt TEXT,
  opening_message TEXT,
  stop_keywords TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_agent_configs_channel_enabled
  ON admin_agent_configs(channel, enabled);
