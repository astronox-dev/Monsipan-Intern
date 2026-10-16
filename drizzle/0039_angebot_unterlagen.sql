CREATE TABLE `offer_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`offer_id` integer NOT NULL,
	`title` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`for_crew` integer DEFAULT false NOT NULL,
	`uploaded_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `offer_documents_offer_idx` ON `offer_documents` (`offer_id`);