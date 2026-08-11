CREATE TABLE "devices" (
	"token" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"doc_count" integer DEFAULT 0,
	"bytes_used" bigint DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "docs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_token" text,
	"version" integer DEFAULT 0 NOT NULL,
	"s3_key" text,
	"name" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
