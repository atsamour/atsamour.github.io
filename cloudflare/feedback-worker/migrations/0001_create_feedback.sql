CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('support', 'bug', 'feature', 'feedback')),
  source TEXT NOT NULL CHECK (source IN ('website', 'extension')),
  name TEXT,
  email TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  extension_version TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'failed')),
  email_message_id TEXT,
  email_error TEXT
);
