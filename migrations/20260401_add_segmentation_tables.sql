-- Migration: Add segmentation tables
-- Date: 2026-04-01

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  criteria TEXT NOT NULL, -- JSON array of SegmentCriteria
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_segments (
  user_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, segment_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

-- Index for efficient segment queries
CREATE INDEX IF NOT EXISTS idx_user_segments_segment_id ON user_segments(segment_id);
CREATE INDEX IF NOT EXISTS idx_user_segments_user_id ON user_segments(user_id);