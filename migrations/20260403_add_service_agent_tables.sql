-- Migration: Add service conversational agent tables
-- Date: 2026-04-03

CREATE TABLE IF NOT EXISTS service_conversation_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_channel TEXT NOT NULL DEFAULT 'whatsapp',
  source_contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'qualified', 'scheduled', 'quoted', 'opt_out', 'closed')),
  latest_intent TEXT CHECK (latest_intent IN ('appointment', 'quote', 'question', 'opt_out', 'other')),
  sentiment_score REAL,
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  notes TEXT,
  next_followup_at TIMESTAMP,
  last_message_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS service_conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'agent', 'system')),
  message_text TEXT NOT NULL,
  intent TEXT CHECK (intent IN ('appointment', 'quote', 'question', 'opt_out', 'other')),
  sentiment_score REAL,
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  ai_model TEXT,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES service_conversation_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS service_appointments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT,
  source_contact TEXT NOT NULL,
  service_type TEXT,
  requested_date TEXT,
  requested_time TEXT,
  timezone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rescheduled', 'cancelled')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES service_conversation_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS service_quotes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT,
  source_contact TEXT NOT NULL,
  service_type TEXT,
  budget_range TEXT,
  timeline TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'sent', 'accepted', 'rejected', 'expired')),
  quote_value REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES service_conversation_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_sessions_contact_updated ON service_conversation_sessions(source_contact, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_sessions_status_updated ON service_conversation_sessions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_messages_session_created ON service_conversation_messages(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_appointments_session_status ON service_appointments(session_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_quotes_session_status ON service_quotes(session_id, status, updated_at DESC);
