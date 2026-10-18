-- Each model's revision: 1 when created, one more on every update. Saves send the revision they were made from
-- (If-Match), so a save made from an older revision is refused instead of overwriting someone else's changes.
-- Rows stored before this migration start at 1.
ALTER TABLE models ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
