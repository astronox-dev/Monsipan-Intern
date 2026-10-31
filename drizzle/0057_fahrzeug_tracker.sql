ALTER TABLE `vehicle_positions` ADD `source` text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `tracking` text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `tracker_imei` text;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `tracker_seen_at` integer;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `ignition` integer;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `odometer_km` real;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `voltage` real;--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_tracker_imei_idx` ON `vehicles` (`tracker_imei`);