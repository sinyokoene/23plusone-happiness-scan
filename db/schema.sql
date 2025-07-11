CREATE TABLE scan_responses (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  card_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  yes_no BOOLEAN NOT NULL,
  response_time INTEGER NOT NULL,
  ihs REAL NOT NULL
);

-- Optionally index by timestamp or domain for analytics:
CREATE INDEX ON scan_responses(timestamp); 