-- Community figures (src/site/community-api.ts). Entries hold nothing about the sender: the place, the figure, the
-- amount, its currency, the day it arrived, how it was sent, and a hash of the removal code given back to the sender.
CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, city TEXT NOT NULL, figure TEXT NOT NULL, value REAL NOT NULL, currency TEXT NOT NULL, day TEXT NOT NULL, via TEXT NOT NULL, removal TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS entries_city ON entries (city);
CREATE INDEX IF NOT EXISTS entries_removal ON entries (removal);
-- The daily limit: a count per salted hash of the sender's network; the salt is random per day. Both are deleted
-- once older than yesterday.
CREATE TABLE IF NOT EXISTS limits (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key));
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
