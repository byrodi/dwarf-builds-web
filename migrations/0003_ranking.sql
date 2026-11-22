-- Ranking: HOT, and TOP of a period (functions/api/builds/index.js).

-- hot = log10(likes + 1) + created_at / HOT_DAYS days (hotScore in functions/_lib/builds.js). It changes only with
-- the likes, so it is stored: set when a build is made and when it is liked or unliked.
ALTER TABLE builds ADD COLUMN hot REAL NOT NULL DEFAULT 0;
-- Builds made before this column rank by age alone until their next like (HOT_DAYS = 7).
UPDATE builds SET hot = created_at / 604800000.0;

CREATE INDEX builds_hidden_hot ON builds (hidden, hot);
CREATE INDEX builds_hidden_class_hot ON builds (hidden, class, hot);

-- TOP of a period counts the likes made in it.
CREATE INDEX likes_created_build ON likes (created_at, build_id);
