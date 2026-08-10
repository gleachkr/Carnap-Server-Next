CREATE TABLE `course_enrollment_links` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `course_enrollment_links_course_id_idx` ON `course_enrollment_links` (`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `course_enrollment_links_token_hash_unique` ON `course_enrollment_links` (`token_hash`);--> statement-breakpoint
ALTER TABLE `courses` ADD `timezone` text DEFAULT 'UTC' NOT NULL;