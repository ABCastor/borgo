-- Calls to the MCP server at /mcp (src/mcp/remote.ts): per day, how many times each method or tool was called and
-- how many of those failed. Nothing about the caller or what they asked.
CREATE TABLE IF NOT EXISTS mcp_counts (day TEXT NOT NULL, what TEXT NOT NULL, calls INTEGER NOT NULL, errors INTEGER NOT NULL, PRIMARY KEY (day, what));
