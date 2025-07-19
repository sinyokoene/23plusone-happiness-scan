-- Updated schema to match server expectations
CREATE TABLE scan_responses (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  card_selections JSONB NOT NULL,
  ihs_score REAL NOT NULL,
  n1_score REAL,
  n2_score REAL, 
  n3_score REAL,

  completion_time INTEGER,
  user_agent TEXT,
  total_cards INTEGER DEFAULT 24,
  selected_count INTEGER,
  rejected_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_scan_responses_timestamp ON scan_responses(timestamp);
CREATE INDEX idx_scan_responses_ihs_score ON scan_responses(ihs_score);
CREATE INDEX idx_scan_responses_session_id ON scan_responses(session_id);


-- Legacy table for compatibility (if needed)
CREATE TABLE IF NOT EXISTS scan_responses_legacy (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  card_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  yes_no BOOLEAN NOT NULL,
  response_time INTEGER NOT NULL,
  ihs REAL NOT NULL
); 