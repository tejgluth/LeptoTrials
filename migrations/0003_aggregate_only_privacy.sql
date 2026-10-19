-- Create aggregate-only storage. Retired tables remain pending explicit deletion approval.
CREATE TABLE trial_contact_counts (
  nct_id TEXT PRIMARY KEY NOT NULL,
  email_clicks INTEGER NOT NULL DEFAULT 0,
  email_copies INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

INSERT INTO trial_contact_counts (nct_id, email_clicks, email_copies)
SELECT nct_id,
  SUM(CASE WHEN action = 'email_click' THEN 1 ELSE 0 END),
  SUM(CASE WHEN action = 'email_copy' THEN 1 ELSE 0 END)
FROM contact_events GROUP BY nct_id;
