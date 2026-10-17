CREATE TABLE `units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_name_unique` ON `units` (`name`);--> statement-breakpoint
/*
 * Startliste: die bisherigen Vorschläge und alles, was schon in Angeboten,
 * Aufträgen, Rechnungen und Tagesberichten steht – ohne Unterschied in der
 * Groß-/Kleinschreibung; dabei gewinnt die Schreibweise der Vorschläge.
 */
INSERT INTO `units` (`name`, `sort_order`)
SELECT `name`, row_number() OVER (ORDER BY `prio`, `name`) - 1 FROM (
	SELECT `name`, min(`prio`) AS `prio` FROM (
		SELECT 'Pauschal' AS `name`, 0 AS `prio`
		UNION ALL SELECT 'lfd. m', 1
		UNION ALL SELECT 'm²', 2
		UNION ALL SELECT 'Stk', 3
		UNION ALL SELECT 'h', 4
		UNION ALL SELECT 'kg', 5
		UNION ALL SELECT 'l', 6
		UNION ALL SELECT trim(`unit`), 100 FROM `offer_positions` WHERE trim(`unit`) <> ''
		UNION ALL SELECT trim(`unit`), 100 FROM `order_positions` WHERE trim(`unit`) <> ''
		UNION ALL SELECT trim(`unit`), 100 FROM `invoice_positions` WHERE trim(`unit`) <> ''
		UNION ALL SELECT trim(`unit`), 100 FROM `daily_report_positions` WHERE trim(`unit`) <> ''
	)
	GROUP BY lower(`name`)
);
