CREATE TABLE `platform_capability_grants` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `capability` text NOT NULL,
  `granted_by_id` text,
  `granted_at` text NOT NULL,
  `revoked_at` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`granted_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `platform_capability_grants_user_id_idx` ON `platform_capability_grants` (`user_id`);
--> statement-breakpoint
CREATE INDEX `platform_capability_grants_capability_idx` ON `platform_capability_grants` (`capability`);
--> statement-breakpoint
CREATE TABLE `admin_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_user_id` text NOT NULL,
  `target_user_id` text,
  `target_course_id` text,
  `action` text NOT NULL,
  `request_id` text NOT NULL,
  `metadata_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`target_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_created_at_idx` ON `admin_audit_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_actor_user_id_idx` ON `admin_audit_events` (`actor_user_id`);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_target_user_id_idx` ON `admin_audit_events` (`target_user_id`);
