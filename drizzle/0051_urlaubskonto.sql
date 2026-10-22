CREATE TABLE `employment_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `employment_periods_user_idx` ON `employment_periods` (`user_id`,`from_date`);--> statement-breakpoint
CREATE TABLE `leave_accounts` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`carryover` real DEFAULT 0 NOT NULL,
	`start_date` text,
	`weeks` real,
	`updated_by` integer,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
