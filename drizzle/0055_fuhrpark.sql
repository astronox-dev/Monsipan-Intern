CREATE TABLE `vehicle_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`at` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`speed` real,
	`heading` real,
	`accuracy` real,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vehicle_positions_vehicle_at_idx` ON `vehicle_positions` (`vehicle_id`,`at`);--> statement-breakpoint
CREATE INDEX `vehicle_positions_at_idx` ON `vehicle_positions` (`at`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`plate` text DEFAULT '' NOT NULL,
	`party_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`device_token_hash` text,
	`device_name` text DEFAULT '' NOT NULL,
	`paired_at` integer,
	`pair_code_hash` text,
	`pair_code_expires` integer,
	`last_seen_at` integer,
	`last_at` integer,
	`last_lat` real,
	`last_lon` real,
	`last_speed` real,
	`last_heading` real,
	`last_accuracy` real,
	`battery` integer,
	`charging` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_device_token_idx` ON `vehicles` (`device_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_pair_code_idx` ON `vehicles` (`pair_code_hash`);