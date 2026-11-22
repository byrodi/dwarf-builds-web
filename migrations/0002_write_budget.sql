-- Per-user daily write budget (see requireActiveUser in functions/_lib/builds.js).
-- write_day: UTC day number (unix ms / 86400000); write_count: writes on that day.

ALTER TABLE users ADD COLUMN write_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN write_count INTEGER NOT NULL DEFAULT 0;
