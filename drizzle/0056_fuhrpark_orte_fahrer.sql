CREATE TABLE `fleet_places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`radius` integer DEFAULT 150 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `geo_addresses` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vehicle_drivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`driver_id` integer,
	`driver_name` text DEFAULT '' NOT NULL,
	`since` integer NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vehicle_drivers_vehicle_idx` ON `vehicle_drivers` (`vehicle_id`,`since`);--> statement-breakpoint
ALTER TABLE `notifications` ADD `batch` text;--> statement-breakpoint
CREATE INDEX `notifications_batch_idx` ON `notifications` (`batch`);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `kind` text DEFAULT 'transporter' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `driver_id` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
-- Anfragen: mit Angebot gilt eine Anfrage jetzt als erledigt
UPDATE `inquiries` SET `closed_at` = coalesce(`updated_at`, `created_at`) WHERE `offer_id` IS NOT NULL AND `closed_at` IS NULL;--> statement-breakpoint
-- Benachrichtigungen: dieselbe Meldung an mehrere Personen gehört zusammen
UPDATE `notifications` SET `batch` = `event` || '|' || `url` || '|' || `title` || '|' || `created_at` WHERE `batch` IS NULL;
