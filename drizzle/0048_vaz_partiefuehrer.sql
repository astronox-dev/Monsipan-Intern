-- Partieführer bekommen 10 % VAZ – auch auf ihren Zetteln, die noch in Arbeit sind und keine haben
UPDATE `timesheets` SET `vaz_percent` = 10
WHERE `vaz_percent` IS NULL AND `status` = 'entwurf'
	AND `user_id` IN (SELECT `id` FROM `users` WHERE `role` = 'partiefuehrer');
