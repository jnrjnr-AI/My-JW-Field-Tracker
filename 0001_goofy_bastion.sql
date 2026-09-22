CREATE TABLE `fieldVisits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`clientId` varchar(64) NOT NULL,
	`person` varchar(255) NOT NULL,
	`territory` varchar(120) NOT NULL,
	`notes` text,
	`needsFollowUp` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fieldVisits_id` PRIMARY KEY(`id`),
	CONSTRAINT `fieldVisits_clientId_unique` UNIQUE(`clientId`)
);
--> statement-breakpoint
CREATE INDEX `fieldVisits_user_created_idx` ON `fieldVisits` (`userId`,`createdAt`);