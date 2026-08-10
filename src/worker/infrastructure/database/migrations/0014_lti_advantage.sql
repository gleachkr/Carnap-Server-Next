CREATE TABLE `lti_deep_link_requests` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `platform_id` text NOT NULL,
  `deployment_id` text NOT NULL,
  `course_id` text NOT NULL,
  `user_id` text NOT NULL,
  `return_url` text NOT NULL,
  `data` text,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  FOREIGN KEY (`platform_id`) REFERENCES `lti_platforms`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`deployment_id`) REFERENCES `lti_deployments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lti_deep_link_requests_expires_at_idx` ON `lti_deep_link_requests` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `lti_grade_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `resource_link_id` text NOT NULL,
  `user_id` text NOT NULL,
  `score` real NOT NULL,
  `max_score` real NOT NULL,
  `score_timestamp` text NOT NULL,
  `status` text NOT NULL,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `next_attempt_at` text NOT NULL,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`resource_link_id`) REFERENCES `lti_resource_links`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lti_grade_jobs_link_user_unique` ON `lti_grade_jobs` (`resource_link_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `lti_grade_jobs_status_next_attempt_idx` ON `lti_grade_jobs` (`status`,`next_attempt_at`);
