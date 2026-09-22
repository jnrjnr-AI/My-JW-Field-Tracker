ALTER TABLE `fieldVisits` DROP INDEX `fieldVisits_clientId_unique`;--> statement-breakpoint
ALTER TABLE `fieldVisits` ADD CONSTRAINT `fieldVisits_user_client_unique` UNIQUE(`userId`,`clientId`);