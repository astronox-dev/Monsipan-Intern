CREATE TABLE `inquiry_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inquiry_id` integer NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inquiry_id`) REFERENCES `inquiries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `inquiry_documents_inquiry_idx` ON `inquiry_documents` (`inquiry_id`);--> statement-breakpoint
CREATE TABLE `record_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inquiry_id` integer,
	`offer_id` integer,
	`sha256` text NOT NULL,
	`thumb_sha256` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size` integer NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inquiry_id`) REFERENCES `inquiries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `record_photos_inquiry_idx` ON `record_photos` (`inquiry_id`);--> statement-breakpoint
CREATE INDEX `record_photos_offer_idx` ON `record_photos` (`offer_id`);