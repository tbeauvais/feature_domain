-- Application models, stored as JSON. created_at (milliseconds) keeps list() in creation order; rowid breaks ties
-- between models created in the same millisecond (the seeded samples).
CREATE TABLE models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX models_created_at ON models (created_at);

-- Site-wide settings and records, e.g. that the samples were seeded.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
