ALTER TABLE `inquiry_documents` ADD `for_crew` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `record_photos` ADD `order_id` integer REFERENCES orders(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `record_photos_order_idx` ON `record_photos` (`order_id`);--> statement-breakpoint
ALTER TABLE `plan_entries` ADD `from_work_order` integer DEFAULT false NOT NULL;