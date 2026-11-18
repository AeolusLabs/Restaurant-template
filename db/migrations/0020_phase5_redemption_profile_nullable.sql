ALTER TABLE "promo_redemptions" DROP CONSTRAINT "promo_redemptions_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "promo_redemptions" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;