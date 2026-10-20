ALTER TABLE `customers` ADD `reverse_charge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `skonto_percent` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `skonto_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `offer_positions` ADD `alternative` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `reverse_charge` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `payment_days` integer;--> statement-breakpoint
ALTER TABLE `offers` ADD `skonto_percent` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `skonto_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_positions` ADD `alternative` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Skonto steht auf der Rechnung – nach dem Ausstellen gesperrt wie alles andere
DROP TRIGGER IF EXISTS `invoices_issued_locked`;--> statement-breakpoint
CREATE TRIGGER `invoices_issued_locked` BEFORE UPDATE ON `invoices`
WHEN OLD.`stage` <> 'entwurf' AND (
	NEW.`stage` = 'entwurf'
	OR (OLD.`stage` = 'storniert' AND NEW.`stage` <> 'storniert')
	OR NEW.`number` IS NOT OLD.`number` OR NEW.`kind` IS NOT OLD.`kind` OR NEW.`date` IS NOT OLD.`date`
	OR NEW.`service_from` IS NOT OLD.`service_from` OR NEW.`service_to` IS NOT OLD.`service_to` OR NEW.`due_date` IS NOT OLD.`due_date`
	OR NEW.`project_number` IS NOT OLD.`project_number` OR NEW.`cost_center` IS NOT OLD.`cost_center`
	OR NEW.`title` IS NOT OLD.`title` OR NEW.`location` IS NOT OLD.`location`
	OR NEW.`customer_name` IS NOT OLD.`customer_name` OR NEW.`customer_addition` IS NOT OLD.`customer_addition`
	OR NEW.`customer_street` IS NOT OLD.`customer_street` OR NEW.`customer_zip` IS NOT OLD.`customer_zip`
	OR NEW.`customer_city` IS NOT OLD.`customer_city` OR NEW.`customer_uid` IS NOT OLD.`customer_uid`
	OR NEW.`intro` IS NOT OLD.`intro` OR NEW.`closing` IS NOT OLD.`closing` OR NEW.`state` IS NOT OLD.`state` OR NEW.`section` IS NOT OLD.`section`
	OR NEW.`vat_rate` IS NOT OLD.`vat_rate` OR NEW.`reverse_charge` IS NOT OLD.`reverse_charge`
	OR NEW.`skonto_percent` IS NOT OLD.`skonto_percent` OR NEW.`skonto_days` IS NOT OLD.`skonto_days`
	OR NEW.`issued_at` IS NOT OLD.`issued_at` OR NEW.`issued_by` IS NOT OLD.`issued_by` OR NEW.`verify_token` IS NOT OLD.`verify_token`
	OR NEW.`retain_until` IS NOT OLD.`retain_until` OR NEW.`cancels_id` IS NOT OLD.`cancels_id`
	OR (OLD.`cancelled_at` IS NOT NULL AND (NEW.`cancelled_at` IS NOT OLD.`cancelled_at` OR NEW.`cancelled_by` IS NOT OLD.`cancelled_by`
		OR NEW.`cancel_reason` IS NOT OLD.`cancel_reason` OR NEW.`storno_id` IS NOT OLD.`storno_id`))
)
BEGIN SELECT RAISE(ABORT, 'Die Rechnung ist ausgestellt und gesperrt.'); END;
