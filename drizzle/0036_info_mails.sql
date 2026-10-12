CREATE TABLE `notification_mail_mutes` (
	`user_id` integer NOT NULL,
	`event` text NOT NULL,
	PRIMARY KEY(`user_id`, `event`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_mail_people` (
	`event` text NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`event`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_mail_rules` (
	`event` text NOT NULL,
	`role` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer,
	PRIMARY KEY(`event`, `role`)
);
