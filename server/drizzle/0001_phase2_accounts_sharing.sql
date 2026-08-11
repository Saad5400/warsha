CREATE TABLE "doc_acl" (
	"doc_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "doc_acl_doc_id_email_pk" PRIMARY KEY("doc_id","email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "link_access" text DEFAULT 'editor' NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" ADD COLUMN "size_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doc_acl" ADD CONSTRAINT "doc_acl_doc_id_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_acl_email_idx" ON "doc_acl" USING btree ("email");--> statement-breakpoint
CREATE INDEX "docs_owner_idx" ON "docs" USING btree ("owner");--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "doc_count";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "bytes_used";--> statement-breakpoint
-- Hand-edited backfill (keep before the owner_token drop): Phase-1 rows stored the raw
-- bearer token that created the doc; every such token acts as a device principal now.
UPDATE "docs" SET "owner" = 'device:' || "owner_token" WHERE "owner_token" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "docs" DROP COLUMN "owner_token";