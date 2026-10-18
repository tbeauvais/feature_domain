-- Each model's version: 1 when created, one more on every update. Saves send the version they were made from
-- (If-Match), so a save made from an older version is refused instead of overwriting someone else's changes.
ALTER TABLE models ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
