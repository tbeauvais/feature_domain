-- Who added each row: the person's id (their Better Auth user, in the app's own tables) on a published app's rows when
-- someone signed in added it, else null (every row stored before, and every draft row: the builder has no app session).
-- A table's Owner rules compare it with the person signed in; deleting an account deletes or keeps their rows by it.
-- Added, so the Worker already running keeps inserting rows without it (null) while the new one uploads.
ALTER TABLE rows ADD COLUMN created_by TEXT;

CREATE INDEX rows_created_by ON rows (model_id, space, created_by) WHERE created_by IS NOT NULL;
