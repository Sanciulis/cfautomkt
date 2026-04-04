-- Migration: Add Telegram conversation tables
-- Date: 20260404
-- Description: Adds tables for Telegram bot conversation management

-- Telegram conversation sessions table
CREATE TABLE IF NOT EXISTS telegram_conversation_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  chat_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'opt_out', 'closed')),
  sentiment_score REAL,
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Telegram conversation messages table
CREATE TABLE IF NOT EXISTS telegram_conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'agent', 'system')),
  message_text TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  sentiment_score REAL,
  sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  ai_model TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES telegram_conversation_sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_user_id ON telegram_conversation_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_chat_id ON telegram_conversation_sessions(chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_status ON telegram_conversation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_telegram_sessions_last_message ON telegram_conversation_sessions(last_message_at);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_session_id ON telegram_conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_created_at ON telegram_conversation_messages(created_at);