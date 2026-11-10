CREATE TABLE "CommunityGuestView" (
	"postId" integer NOT NULL,
	"guestHash" text NOT NULL,
	"hourBucket" integer NOT NULL,
	"viewedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CommunityGuestView_postId_guestHash_hourBucket_pk" PRIMARY KEY("postId","guestHash","hourBucket")
);
--> statement-breakpoint
ALTER TABLE "MediaAsset" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "MediaAsset" ADD COLUMN "storagePath" text;--> statement-breakpoint
ALTER TABLE "MediaAsset" ADD COLUMN "previewPath" text;--> statement-breakpoint
ALTER TABLE "CommunityGuestView" ADD CONSTRAINT "CommunityGuestView_postId_CommunityPost_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."CommunityPost"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "CommunityGuestView_bucket_idx" ON "CommunityGuestView" USING btree ("hourBucket");