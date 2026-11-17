ALTER TABLE "orders" DROP CONSTRAINT "orders_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_token_unique" UNIQUE("profile_id","checkout_token");