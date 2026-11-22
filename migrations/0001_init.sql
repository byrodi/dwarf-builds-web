-- Dwarf Builds: first schema. Times are unix milliseconds.

CREATE TABLE users (
  steam_id   TEXT PRIMARY KEY,
  name       TEXT,
  avatar     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  banned     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE builds (
  id             TEXT PRIMARY KEY,           -- 8 random base62
  user_id        TEXT NOT NULL REFERENCES users(steam_id),
  class          TEXT NOT NULL,              -- D, E, G, S
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  code           TEXT NOT NULL,              -- canonical DB1 code
  build_json     TEXT NOT NULL,              -- stable asset names, see code.js validateBuild
  primary_item   TEXT,                       -- item id, e.g. FlameThrower
  secondary_item TEXT,
  primary_oc     TEXT,                       -- overclock id or NULL
  secondary_oc   TEXT,
  likes          INTEGER NOT NULL DEFAULT 0, -- kept by the likes triggers
  hidden         INTEGER NOT NULL DEFAULT 0,
  data_version   TEXT,                       -- game.json version used to check the code
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX builds_hidden_class_created ON builds (hidden, class, created_at);
CREATE INDEX builds_hidden_class_likes ON builds (hidden, class, likes, created_at);
CREATE INDEX builds_hidden_created ON builds (hidden, created_at);
CREATE INDEX builds_hidden_likes ON builds (hidden, likes, created_at);
CREATE INDEX builds_user_created ON builds (user_id, created_at);
CREATE INDEX builds_primary_item ON builds (primary_item);
CREATE INDEX builds_secondary_item ON builds (secondary_item);

CREATE TABLE likes (
  build_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (build_id, user_id)
);

CREATE TABLE reports (
  id         INTEGER PRIMARY KEY,
  build_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX reports_build ON reports (build_id, user_id);
CREATE INDEX reports_user_created ON reports (user_id, created_at);

-- builds.likes always equals the number of likes rows.
CREATE TRIGGER likes_insert AFTER INSERT ON likes
BEGIN
  UPDATE builds SET likes = likes + 1 WHERE id = NEW.build_id;
END;

CREATE TRIGGER likes_delete AFTER DELETE ON likes
BEGIN
  UPDATE builds SET likes = MAX(likes - 1, 0) WHERE id = OLD.build_id;
END;
