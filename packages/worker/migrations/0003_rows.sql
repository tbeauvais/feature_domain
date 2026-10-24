-- Database tables' rows (D1RowStore): one per row, its field values as JSON, kept per model, space (the draft's rows,
-- or later a published app's live ones) and table (the Database table's instance id). The Worker deletes a model's rows
-- when it deletes the model (no foreign key: rebuilding `models` in a later migration would cascade into every row).
-- created_at (milliseconds) and then rowid keep rows in the order they were added.
CREATE TABLE rows (
  model_id TEXT NOT NULL,
  space TEXT NOT NULL CHECK (space IN ('draft', 'live')),
  table_key TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model_id, space, table_key, id)
);

CREATE INDEX rows_order ON rows (model_id, space, table_key, created_at);

-- The tables whose sample rows were stored, so they are stored once: not again after their rows are deleted.
-- `token` is the request that stored them, so only that request's batch adds the rows.
CREATE TABLE sampled_tables (
  model_id TEXT NOT NULL,
  space TEXT NOT NULL CHECK (space IN ('draft', 'live')),
  table_key TEXT NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY (model_id, space, table_key)
);
