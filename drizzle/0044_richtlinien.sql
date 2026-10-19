CREATE TABLE `policy_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `policy_folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `policy_documents_folder_idx` ON `policy_documents` (`folder_id`);--> statement-breakpoint
CREATE TABLE `policy_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `policy_folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `policy_folders_parent_idx` ON `policy_folders` (`parent_id`);