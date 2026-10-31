-- Which published apps have sign-in tables, and at which version of their schema (src/auth/tables.ts). Each app's
-- Better Auth tables are named after `key`, a random 32-hex string made when they are first created: never the model's
-- id (seeded samples have ids such as sample-2-6), and never anything a request names.
CREATE TABLE app_auth (
  model_id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL
);
