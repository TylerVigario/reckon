-- BETTER AUTH'S ROUTES ARE COUNTED (#lib/server/auth). Mounted under /api/auth,
-- its rate limiter keeps its counts here rather than in memory, so a restart
-- forgives nothing: one row per address and route, how many requests it has
-- made in the window, and when the last was, in milliseconds.
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_key" UNIQUE("key")
);
