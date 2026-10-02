-- One row a player: the name on the board, and the most a save of theirs has
-- earned once the server read it with the game's own rules. key_hash is the
-- SHA-256 of the secret the plugin keeps.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  best REAL NOT NULL DEFAULT 0,
  best_at INTEGER NOT NULL DEFAULT 0,
  ships INTEGER NOT NULL DEFAULT 0,
  -- The latest save taken, so one that looks wrong can be read and removed,
  -- and what it claims while it is held back to be looked over.
  save TEXT NOT NULL DEFAULT '',
  claim REAL NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX players_best ON players (best DESC, best_at);

-- Who wrote lately, to slow a flood: a salted hash of the address, kept an hour.
CREATE TABLE hits (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX hits_ip ON hits (ip, at);
