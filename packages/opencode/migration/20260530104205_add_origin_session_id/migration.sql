ALTER TABLE `session` ADD `origin_session_id` text;--> statement-breakpoint
CREATE INDEX `session_origin_idx` ON `session` (`origin_session_id`);