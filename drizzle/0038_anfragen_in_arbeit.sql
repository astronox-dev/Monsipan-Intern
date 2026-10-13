ALTER TABLE `inquiries` ADD `in_progress_at` integer;--> statement-breakpoint
ALTER TABLE `inquiries` ADD `in_progress_by` integer REFERENCES users(id) ON DELETE set null;