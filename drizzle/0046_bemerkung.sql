ALTER TABLE `invoice_positions` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `offer_positions` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_positions` ADD `note` text DEFAULT '' NOT NULL;