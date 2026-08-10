CREATE TABLE `course_accommodations` (
  `id` text PRIMARY KEY NOT NULL,
  `course_id` text NOT NULL,
  `user_id` text NOT NULL,
  `extra_attempts` integer DEFAULT 0 NOT NULL,
  `time_limit_multiplier` real DEFAULT 1 NOT NULL,
  `due_at_extension_minutes` integer DEFAULT 0 NOT NULL,
  `available_until_extension_minutes` integer DEFAULT 0 NOT NULL,
  `created_by_id` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_accommodations_course_user_unique`
ON `course_accommodations` (`course_id`, `user_id`);
--> statement-breakpoint
CREATE TABLE `content_tags` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `name` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_tags_owner_name_unique`
ON `content_tags` (`owner_user_id`, `name`);
--> statement-breakpoint
CREATE TABLE `content_item_tags` (
  `item_id` text NOT NULL,
  `tag_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tag_id`) REFERENCES `content_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_item_tags_item_tag_unique`
ON `content_item_tags` (`item_id`, `tag_id`);
--> statement-breakpoint
CREATE TABLE `assignment_late_policies` (
  `assignment_id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `percent_penalty` real NOT NULL,
  `max_percent_penalty` real NOT NULL,
  `grace_minutes` integer DEFAULT 0 NOT NULL,
  `created_by_id` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `assignment_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `assignment_id` text NOT NULL,
  `user_id` text NOT NULL,
  `available_from` text,
  `due_at` text,
  `available_until` text,
  `max_attempts` integer,
  `time_limit_minutes` integer,
  `created_by_id` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_overrides_assignment_user_unique`
ON `assignment_overrides` (`assignment_id`, `user_id`);
