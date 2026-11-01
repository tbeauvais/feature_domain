-- People whose accounts were deleted, per model and space: no row is added in their name afterwards, even by a request
-- that read their session before the deletion (the insert checks this in the same statement). Written once the account
-- is gone, so a deletion that fails locks no one out.
CREATE TABLE forgotten_people (
  model_id TEXT NOT NULL,
  space TEXT NOT NULL CHECK (space IN ('draft', 'live')),
  person TEXT NOT NULL,
  PRIMARY KEY (model_id, space, person)
);
