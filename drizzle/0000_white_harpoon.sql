CREATE TABLE `agent_branches` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_branch_idx` UNIQUE(`user_id`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `ai_replies` (
	`id` varchar(36) NOT NULL,
	`review_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`reply` text NOT NULL,
	`posted` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_reports` (
	`id` varchar(36) NOT NULL,
	`business_id` varchar(36) NOT NULL,
	`score` int NOT NULL,
	`report_data` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` varchar(36) NOT NULL,
	`business_id` varchar(36) NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`qr_code` text,
	`public_slug` varchar(255) NOT NULL,
	`low_rating_threshold` int NOT NULL DEFAULT 3,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_slug_idx` UNIQUE(`public_slug`)
);
--> statement-breakpoint
CREATE TABLE `businesses` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` text NOT NULL,
	`industry` text,
	`google_place_id` text,
	`google_review_url` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `businesses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contact_messages` (
	`id` varchar(36) NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`message` text NOT NULL,
	`plan` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contact_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` varchar(36) NOT NULL,
	`branch_id` varchar(36) NOT NULL,
	`customer_name` text,
	`customer_email` text,
	`rating` int NOT NULL,
	`content` text,
	`ai_generated` boolean NOT NULL DEFAULT false,
	`status` enum('pending','public','private','ignored') NOT NULL DEFAULT 'public',
	`google_review_link` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`plan` enum('silver','gold','platinum') NOT NULL DEFAULT 'silver',
	`ai_tokens_used` int NOT NULL DEFAULT 0,
	`ai_tokens_limit` int NOT NULL DEFAULT 10000,
	`max_branches` int NOT NULL DEFAULT 2,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`role` enum('admin','owner','agent') NOT NULL DEFAULT 'owner',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_idx` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `agent_branches` ADD CONSTRAINT `agent_branches_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_branches` ADD CONSTRAINT `agent_branches_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_replies` ADD CONSTRAINT `ai_replies_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_replies` ADD CONSTRAINT `ai_replies_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_reports` ADD CONSTRAINT `audit_reports_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `businesses` ADD CONSTRAINT `businesses_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `branches_business_idx` ON `branches` (`business_id`);--> statement-breakpoint
CREATE INDEX `businesses_user_idx` ON `businesses` (`user_id`);--> statement-breakpoint
CREATE INDEX `reviews_branch_idx` ON `reviews` (`branch_id`);--> statement-breakpoint
CREATE INDEX `reviews_status_idx` ON `reviews` (`status`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);