CREATE TABLE `leave_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`days` real DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'beantragt' NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`decision_note` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `leave_requests_user_idx` ON `leave_requests` (`user_id`,`from_date`);--> statement-breakpoint
CREATE INDEX `leave_requests_status_idx` ON `leave_requests` (`status`);--> statement-breakpoint
CREATE INDEX `leave_requests_range_idx` ON `leave_requests` (`from_date`,`to_date`);--> statement-breakpoint
CREATE TABLE `plan_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`party_id` integer NOT NULL,
	`order_id` integer,
	`text` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plan_entries_date_idx` ON `plan_entries` (`date`);--> statement-breakpoint
CREATE INDEX `plan_entries_party_idx` ON `plan_entries` (`party_id`,`date`);--> statement-breakpoint
CREATE INDEX `plan_entries_order_idx` ON `plan_entries` (`order_id`);--> statement-breakpoint
CREATE TABLE `plan_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sick_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_id` integer NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text DEFAULT '' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `sick_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sick_documents_report_idx` ON `sick_documents` (`report_id`);--> statement-breakpoint
CREATE TABLE `sick_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sick_reports_user_idx` ON `sick_reports` (`user_id`,`from_date`);--> statement-breakpoint
CREATE INDEX `sick_reports_range_idx` ON `sick_reports` (`from_date`,`to_date`);