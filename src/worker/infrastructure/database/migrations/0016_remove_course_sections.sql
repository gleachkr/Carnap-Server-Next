DROP INDEX `assignments_course_order_idx`;
--> statement-breakpoint
ALTER TABLE `assignments` DROP COLUMN `section_id`;
--> statement-breakpoint
CREATE INDEX `assignments_course_order_idx` ON `assignments` (`course_id`, `display_order`, `id`);
--> statement-breakpoint
DROP TABLE `course_sections`;
