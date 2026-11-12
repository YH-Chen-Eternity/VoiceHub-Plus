CREATE TABLE "OpsBoardSettings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cosQuotaBytes" bigint,
	"logRetentionDays" integer DEFAULT 30 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CommunityPost" ADD COLUMN "nameMode" text DEFAULT 'semi' NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunitySettings" ADD COLUMN "allowSemi" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunitySettings" ADD COLUMN "allowRealname" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "CommunitySettings" ADD COLUMN "allowAnonymous" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "SystemSettings" ADD COLUMN "opsAlertRecipients" text;