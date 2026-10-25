-- Claims on a model's publishing (D1AppStore.claim): one request at a time publishes a model or deletes it, so a publish
-- never acts on rows or versions another request is changing. A claim older than a minute is taken over.
CREATE TABLE publishing (
  model_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  since INTEGER NOT NULL
);
