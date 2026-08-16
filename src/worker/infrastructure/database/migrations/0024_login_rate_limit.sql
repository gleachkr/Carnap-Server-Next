-- `POST /login` had no throttle at all: the `LoginRateLimiter` seam existed but
-- every construction site fell through to the allow-all one. So anyone could
-- make an instance send unlimited login emails to addresses of their choosing,
-- which burns the operator's mail quota and puts the sending domain's
-- reputation in someone else's hands.
--
-- This is the counter behind the fix. One row per login email actually sent,
-- counted over a rolling window, and dropped once it ages out of that window.
--
-- `bucket` is not the address or the IP: it is a scope tag plus the SHA-256 of
-- the value, the same hash the session and login tokens already use. The
-- limiter only ever asks "how many hits does this exact key have", which a
-- hash answers as well as the plaintext would, and hashing means an instance
-- that throttles by IP is not thereby keeping a log of who asked to sign in
-- from where. Rows are pruned on every check, so the table stays roughly as
-- large as one window's traffic rather than growing forever.
CREATE TABLE `login_rate_limit_hits` (
  `id` text PRIMARY KEY NOT NULL,
  `bucket` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_rate_limit_hits_bucket_idx` ON `login_rate_limit_hits` (`bucket`,`created_at`);
--> statement-breakpoint
CREATE INDEX `login_rate_limit_hits_created_at_idx` ON `login_rate_limit_hits` (`created_at`);
