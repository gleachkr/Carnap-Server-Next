ALTER TABLE `assignments` ADD `grades_visible_at` text;
--> statement-breakpoint
ALTER TABLE `assignment_scores` ADD `status` text DEFAULT 'not-started' NOT NULL;
