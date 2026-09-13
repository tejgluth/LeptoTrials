CREATE TABLE trial_suggestions (
  nct_id TEXT PRIMARY KEY,
  categories TEXT NOT NULL,
  relevance TEXT NOT NULL,
  title TEXT NOT NULL,
  study_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE INDEX trial_suggestions_submitted_at ON trial_suggestions(submitted_at DESC);

CREATE TABLE suggestion_rate_limits (
  client_key TEXT PRIMARY KEY,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX suggestion_rate_limits_hour ON suggestion_rate_limits(hour);
