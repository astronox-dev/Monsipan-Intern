CREATE TABLE `invoice_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`invoice_id` integer,
	`invoice_number` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`user_id` integer,
	`user_name` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invoice_audit_invoice_idx` ON `invoice_audit` (`invoice_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_audit_prev_idx` ON `invoice_audit` (`prev_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_audit_hash_idx` ON `invoice_audit` (`hash`);--> statement-breakpoint
CREATE TABLE `invoice_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`content_hash` text,
	`created_by` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_files_kind_idx` ON `invoice_files` (`invoice_id`,`kind`);--> statement-breakpoint
CREATE TABLE `invoice_signatures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	`provider` text NOT NULL,
	`requested_level` text NOT NULL,
	`level` text NOT NULL,
	`signed_at` integer NOT NULL,
	`timestamp_at` integer,
	`tsa` text DEFAULT '' NOT NULL,
	`cert_name` text NOT NULL,
	`cert_organization` text DEFAULT '' NOT NULL,
	`cert_issuer` text NOT NULL,
	`cert_serial` text NOT NULL,
	`cert_fingerprint` text NOT NULL,
	`cert_not_before` text NOT NULL,
	`cert_not_after` text NOT NULL,
	`qualification` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `invoice_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_signatures_invoice_idx` ON `invoice_signatures` (`invoice_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `stage` text DEFAULT 'entwurf' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `issued_at` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `issued_by` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `verify_token` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `retain_until` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `sign_error` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `checked_at` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `check_result` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `check_detail` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `cancelled_by` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `storno_id` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `cancels_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_verify_token_idx` ON `invoices` (`verify_token`);--> statement-breakpoint
CREATE INDEX `invoices_stage_idx` ON `invoices` (`stage`);--> statement-breakpoint
-- Ausgestellte Rechnungen: was auf der Rechnung steht, bleibt, wie es ist. Erlaubt sind nur
-- Zahlung (offen/bezahlt), die Signatur-Schritte, Prüfergebnisse und einmalig das Storno.
CREATE TRIGGER `invoices_issued_locked` BEFORE UPDATE ON `invoices`
WHEN OLD.`stage` <> 'entwurf' AND (
	NEW.`stage` = 'entwurf'
	OR (OLD.`stage` = 'storniert' AND NEW.`stage` <> 'storniert')
	OR NEW.`number` IS NOT OLD.`number` OR NEW.`kind` IS NOT OLD.`kind` OR NEW.`date` IS NOT OLD.`date`
	OR NEW.`service_from` IS NOT OLD.`service_from` OR NEW.`service_to` IS NOT OLD.`service_to` OR NEW.`due_date` IS NOT OLD.`due_date`
	OR NEW.`project_number` IS NOT OLD.`project_number` OR NEW.`title` IS NOT OLD.`title` OR NEW.`location` IS NOT OLD.`location`
	OR NEW.`customer_name` IS NOT OLD.`customer_name` OR NEW.`customer_addition` IS NOT OLD.`customer_addition`
	OR NEW.`customer_street` IS NOT OLD.`customer_street` OR NEW.`customer_zip` IS NOT OLD.`customer_zip`
	OR NEW.`customer_city` IS NOT OLD.`customer_city` OR NEW.`customer_uid` IS NOT OLD.`customer_uid`
	OR NEW.`intro` IS NOT OLD.`intro` OR NEW.`closing` IS NOT OLD.`closing` OR NEW.`state` IS NOT OLD.`state` OR NEW.`section` IS NOT OLD.`section`
	OR NEW.`vat_rate` IS NOT OLD.`vat_rate` OR NEW.`reverse_charge` IS NOT OLD.`reverse_charge`
	OR NEW.`issued_at` IS NOT OLD.`issued_at` OR NEW.`issued_by` IS NOT OLD.`issued_by` OR NEW.`verify_token` IS NOT OLD.`verify_token`
	OR NEW.`retain_until` IS NOT OLD.`retain_until` OR NEW.`cancels_id` IS NOT OLD.`cancels_id`
	OR (OLD.`cancelled_at` IS NOT NULL AND (NEW.`cancelled_at` IS NOT OLD.`cancelled_at` OR NEW.`cancelled_by` IS NOT OLD.`cancelled_by`
		OR NEW.`cancel_reason` IS NOT OLD.`cancel_reason` OR NEW.`storno_id` IS NOT OLD.`storno_id`))
)
BEGIN SELECT RAISE(ABORT, 'Die Rechnung ist ausgestellt und gesperrt.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoices_issued_no_delete` BEFORE DELETE ON `invoices` WHEN OLD.`stage` <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Ausgestellte Rechnungen lassen sich nicht löschen.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_positions_locked_insert` BEFORE INSERT ON `invoice_positions`
WHEN (SELECT `stage` FROM `invoices` WHERE `id` = NEW.`invoice_id`) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Die Rechnung ist ausgestellt und gesperrt.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_positions_locked_update` BEFORE UPDATE ON `invoice_positions`
WHEN (SELECT `stage` FROM `invoices` WHERE `id` = OLD.`invoice_id`) <> 'entwurf' OR (SELECT `stage` FROM `invoices` WHERE `id` = NEW.`invoice_id`) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Die Rechnung ist ausgestellt und gesperrt.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_positions_locked_delete` BEFORE DELETE ON `invoice_positions`
WHEN (SELECT `stage` FROM `invoices` WHERE `id` = OLD.`invoice_id`) <> 'entwurf'
BEGIN SELECT RAISE(ABORT, 'Die Rechnung ist ausgestellt und gesperrt.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_files_no_update` BEFORE UPDATE ON `invoice_files`
BEGIN SELECT RAISE(ABORT, 'Archivierte Rechnungen sind unveränderlich.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_files_no_delete` BEFORE DELETE ON `invoice_files`
BEGIN SELECT RAISE(ABORT, 'Archivierte Rechnungen sind unveränderlich.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_signatures_no_update` BEFORE UPDATE ON `invoice_signatures`
BEGIN SELECT RAISE(ABORT, 'Signaturangaben sind unveränderlich.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_signatures_no_delete` BEFORE DELETE ON `invoice_signatures`
BEGIN SELECT RAISE(ABORT, 'Signaturangaben sind unveränderlich.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_audit_no_update` BEFORE UPDATE ON `invoice_audit`
BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderlich.'); END;
--> statement-breakpoint
CREATE TRIGGER `invoice_audit_no_delete` BEFORE DELETE ON `invoice_audit`
BEGIN SELECT RAISE(ABORT, 'Das Protokoll ist unveränderlich.'); END;
