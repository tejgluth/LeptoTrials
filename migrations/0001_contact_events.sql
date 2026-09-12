CREATE TABLE IF NOT EXISTS contact_events (
  id TEXT PRIMARY KEY NOT NULL,
  nct_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('email_click', 'email_copy')),
  recorded_at TEXT NOT NULL,
  recorded_at_epoch INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_contact_events_recorded_at
  ON contact_events(recorded_at_epoch);

CREATE INDEX IF NOT EXISTS idx_contact_events_trial_activity
  ON contact_events(nct_id, recorded_at_epoch DESC);
