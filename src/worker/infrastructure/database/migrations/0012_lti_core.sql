CREATE TABLE `lti_platforms` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `issuer` text NOT NULL,
  `client_id` text NOT NULL,
  `authorization_endpoint` text NOT NULL,
  `token_endpoint` text NOT NULL,
  `jwks_uri` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lti_platforms_issuer_client_unique` ON `lti_platforms` (`issuer`,`client_id`);
--> statement-breakpoint
CREATE TABLE `lti_deployments` (
  `id` text PRIMARY KEY NOT NULL,
  `platform_id` text NOT NULL,
  `deployment_id` text NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`platform_id`) REFERENCES `lti_platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lti_deployments_platform_deployment_unique` ON `lti_deployments` (`platform_id`,`deployment_id`);
--> statement-breakpoint
CREATE TABLE `lti_contexts` (
  `id` text PRIMARY KEY NOT NULL,
  `deployment_id` text NOT NULL,
  `context_id` text NOT NULL,
  `course_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`deployment_id`) REFERENCES `lti_deployments`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lti_contexts_deployment_context_unique` ON `lti_contexts` (`deployment_id`,`context_id`);
--> statement-breakpoint
CREATE INDEX `lti_contexts_course_id_idx` ON `lti_contexts` (`course_id`);
--> statement-breakpoint
CREATE TABLE `lti_resource_links` (
  `id` text PRIMARY KEY NOT NULL,
  `context_id` text NOT NULL,
  `resource_link_id` text NOT NULL,
  `title` text DEFAULT '' NOT NULL,
  `assignment_id` text,
  `ags_line_item_url` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`context_id`) REFERENCES `lti_contexts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lti_resource_links_context_link_unique` ON `lti_resource_links` (`context_id`,`resource_link_id`);
--> statement-breakpoint
CREATE INDEX `lti_resource_links_assignment_id_idx` ON `lti_resource_links` (`assignment_id`);
--> statement-breakpoint
CREATE TABLE `lti_login_states` (
  `state_hash` text PRIMARY KEY NOT NULL,
  `nonce_hash` text NOT NULL,
  `platform_id` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  FOREIGN KEY (`platform_id`) REFERENCES `lti_platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lti_login_states_expires_at_idx` ON `lti_login_states` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `lti_link_challenges` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `platform_id` text NOT NULL,
  `subject` text NOT NULL,
  `email` text NOT NULL,
  `name` text,
  `user_id` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  FOREIGN KEY (`platform_id`) REFERENCES `lti_platforms`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lti_link_challenges_platform_subject_idx` ON `lti_link_challenges` (`platform_id`,`subject`);
