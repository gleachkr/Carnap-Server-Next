ALTER TABLE `submissions` ADD `content_revision_id` text REFERENCES `content_revisions`(`id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `submissions` ADD `exercise_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `declaration_hash` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `answer_kind` text;
