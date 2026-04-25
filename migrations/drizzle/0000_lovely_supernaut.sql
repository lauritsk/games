CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leaderboard_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`device_id` text,
	`game_id` text NOT NULL,
	`username` text NOT NULL,
	`normalized_username` text NOT NULL,
	`difficulty` text,
	`outcome` text NOT NULL,
	`metric` text NOT NULL,
	`metric_value` integer NOT NULL,
	`score` integer,
	`moves` integer,
	`duration_ms` integer,
	`level` integer,
	`streak` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leaderboard_scores_game_metric_idx` ON `leaderboard_scores` (`game_id`,`metric`,"metric_value" DESC,"created_at" ASC);--> statement-breakpoint
CREATE INDEX `leaderboard_scores_game_created_idx` ON `leaderboard_scores` (`game_id`,"created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_scores_device_run_idx` ON `leaderboard_scores` (`device_id`,`run_id`) WHERE "leaderboard_scores"."device_id" IS NOT NULL AND "leaderboard_scores"."run_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `preferences` (
	`device_id` text NOT NULL,
	`game_id` text NOT NULL,
	`data_json` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`device_id`, `game_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `result_clears` (
	`device_id` text NOT NULL,
	`game_id` text NOT NULL,
	`cleared_at` text NOT NULL,
	PRIMARY KEY(`device_id`, `game_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `results` (
	`device_id` text NOT NULL,
	`id` text NOT NULL,
	`run_id` text NOT NULL,
	`game_id` text NOT NULL,
	`finished_at` text NOT NULL,
	`difficulty` text,
	`outcome` text NOT NULL,
	`score` integer,
	`moves` integer,
	`duration_ms` integer,
	`level` integer,
	`streak` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`device_id`, `id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `results_device_finished_idx` ON `results` (`device_id`,"finished_at" DESC);--> statement-breakpoint
CREATE INDEX `results_device_game_finished_idx` ON `results` (`device_id`,`game_id`,"finished_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX `results_device_id_run_id_unique` ON `results` (`device_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `saves` (
	`device_id` text NOT NULL,
	`game_id` text NOT NULL,
	`data_json` text,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`device_id`, `game_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "saves_data_or_deleted_check" CHECK("saves"."data_json" IS NOT NULL OR "saves"."deleted_at" IS NOT NULL)
);
