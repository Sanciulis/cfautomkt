-- Migration: Add newsletter conversational agent tables
-- Date: 2026-04-02

CREATE TABLE IF NOT EXISTS newsletter_conversation_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_channel TEXT NOT NULL DEFAULT 'whatsapp',
  source_contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'opt_out', 'closed')),
  sentiment_score REAL,
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  feedback_rating INTEGER CHECK (feedback_rating IS NULL OR (feedback_rating BETWEEN 1 AND 5)),
  feedback_text TEXT,
  converted_at TIMESTAMP,
  last_message_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS newsletter_conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'agent', 'system')),
  message_text TEXT NOT NULL,
  sentiment_score REAL,
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  ai_model TEXT,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES newsletter_conversation_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_newsletter_sessions_status_updated ON newsletter_conversation_sessions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_sessions_contact_updated ON newsletter_conversation_sessions(source_contact, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_messages_session_created ON newsletter_conversation_messages(session_id, created_at DESC);
