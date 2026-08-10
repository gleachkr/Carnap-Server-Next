ALTER TABLE `assignments` ADD `max_attempts` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `time_limit_minutes` integer;--> statement-breakpoint
ALTER TABLE `attempts` ADD `ordinal` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `attempts` RENAME COLUMN `started_at` TO `opened_at`;--> statement-breakpoint
ALTER TABLE `attempts` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `voided_by_id` text REFERENCES `users`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `attempts` ADD `void_reason` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `created_from` text DEFAULT 'student' NOT NULL;--> statement-breakpoint
UPDATE `attempts` SET `status` = 'active' WHERE `status` = 'open';--> statement-breakpoint
UPDATE `attempts` SET `status` = 'voided' WHERE `status` = 'void';--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_assignment_user_ordinal_unique` ON `attempts` (`assignment_id`,`user_id`,`ordinal`);
