CREATE TABLE `course_sections` (
  `id` text PRIMARY KEY NOT NULL,
  `course_id` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `display_order` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_sections_course_order_idx` ON `course_sections` (`course_id`, `display_order`, `id`);
--> statement-breakpoint
ALTER TABLE `assignments` ADD `assessment_mode` text DEFAULT 'graded' NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `practice_record_progress` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `practice_server_checked` integer DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `section_id` text REFERENCES `course_sections`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `assignments` ADD `display_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `assignments_course_order_idx` ON `assignments` (`course_id`, `section_id`, `display_order`, `id`);
