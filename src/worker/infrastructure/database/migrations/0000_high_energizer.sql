CREATE TABLE `assignment_scores` (
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`score` real NOT NULL,
	`max_score` real NOT NULL,
	`calculated_at` text NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_scores_assignment_user_unique` ON `assignment_scores` (`assignment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`content_revision_id` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`available_from` text,
	`due_at` text,
	`created_by_id` text NOT NULL,
	`published_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_revision_id`) REFERENCES `content_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `assignments_course_id_idx` ON `assignments` (`course_id`);--> statement-breakpoint
CREATE INDEX `assignments_content_revision_id_idx` ON `assignments` (`content_revision_id`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`submitted_at` text,
	`voided_at` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_assignment_user_idx` ON `attempts` (`assignment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `content_items_owner_user_id_idx` ON `content_items` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`source_format` text NOT NULL,
	`source_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`compiled_json` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_revisions_item_number_unique` ON `content_revisions` (`item_id`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_revisions_item_hash_unique` ON `content_revisions` (`item_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `course_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_memberships_user_id_idx` ON `course_memberships` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `course_memberships_course_user_unique` ON `course_memberships` (`course_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `courses_created_by_id_idx` ON `courses` (`created_by_id`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`evaluator_kind` text NOT NULL,
	`checker_version` text,
	`result_json` text NOT NULL,
	`score` real NOT NULL,
	`max_score` real NOT NULL,
	`created_at` text NOT NULL,
	`voided_at` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluations_submission_id_idx` ON `evaluations` (`submission_id`);--> statement-breakpoint
CREATE TABLE `external_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_identities_user_id_idx` ON `external_identities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_identities_provider_subject_unique` ON `external_identities` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text,
	`answer_json` text NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submissions_attempt_id_idx` ON `submissions` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_attempt_idempotency_unique` ON `submissions` (`attempt_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);