-- Migration: Add AI inference observability table
-- Date: 2026-04-01

CREATE TABLE IF NOT EXISTS ai_inference_logs (
  id TEXT PRIMARY KEY,
  flow TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  latency_ms INTEGER NOT NULL,
  fallback_used INTEGER DEFAULT 0 CHECK (fallback_used IN (0, 1)),
  prompt_hash TEXT,
  error_message TEXT,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_inference_logs_flow_created_at ON ai_inference_logs(flow, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_inference_logs_status_created_at ON ai_inference_logs(status, created_at DESC);
