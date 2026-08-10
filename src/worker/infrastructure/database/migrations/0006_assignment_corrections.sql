CREATE TABLE `assignment_content_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`content_revision_id` text NOT NULL,
	`effective_at` text NOT NULL,
	`actor_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_revision_id`) REFERENCES `content_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `assignment_content_versions_assignment_id_idx` ON `assignment_content_versions` (`assignment_id`);--> statement-breakpoint
CREATE INDEX `assignment_content_versions_revision_id_idx` ON `assignment_content_versions` (`content_revision_id`);--> statement-breakpoint
CREATE TABLE `assignment_exercise_excuses` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`status` text DEFAULT 'excused' NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_exercise_excuses_assignment_exercise_unique` ON `assignment_exercise_excuses` (`assignment_id`,`exercise_id`);--> statement-breakpoint
CREATE INDEX `assignment_exercise_excuses_assignment_id_idx` ON `assignment_exercise_excuses` (`assignment_id`);
