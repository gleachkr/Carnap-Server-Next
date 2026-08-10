ALTER TABLE `users` ADD `email_verified_at` text;
--> statement-breakpoint
UPDATE `users` SET `email_verified_at` = `created_at` WHERE `id` IN (
  SELECT `user_id` FROM `external_identities` WHERE `provider` = 'native'
);
