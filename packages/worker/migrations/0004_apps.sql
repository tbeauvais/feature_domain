-- Published apps (D1AppStore). Each publish stores the model as a numbered version that never changes; a model's app
-- names its address (slug, at <slug>.<app domain>) and the version it serves. Unpublishing removes the app, keeping its
-- versions (and its live rows, in `rows`), so publishing again counts on from the last version. The Worker deletes a
-- model's versions and app when it deletes the model (no foreign key to `models`, as for rows).
CREATE TABLE versions (
  model_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  model TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (model_id, number)
);

CREATE TABLE apps (
  model_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,
  published_at INTEGER NOT NULL
);
