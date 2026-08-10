ALTER TABLE `assignments` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `available_until` text;--> statement-breakpoint
ALTER TABLE `assignments` ADD `listed` integer DEFAULT true NOT NULL;