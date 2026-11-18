CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"promo_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"discount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "promo_redemptions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"value" bigint,
	"min_order_minor" bigint DEFAULT 0 NOT NULL,
	"max_discount_minor" bigint,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"max_per_customer" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promos_code_unique" UNIQUE("code"),
	CONSTRAINT "promos_kind_check" CHECK ("promos"."kind" in ('percent', 'fixed', 'free_delivery')),
	CONSTRAINT "promos_value_check" CHECK (("promos"."kind" = 'percent' and "promos"."value" between 1 and 10000) or ("promos"."kind" = 'fixed' and "promos"."value" > 0) or ("promos"."kind" = 'free_delivery' and "promos"."value" is null)),
	CONSTRAINT "promos_code_check" CHECK ("promos"."code" ~ '^[A-Z0-9_-]{3,20}$'),
	CONSTRAINT "promos_limits_check" CHECK ("promos"."min_order_minor" >= 0 and ("promos"."max_discount_minor" is null or "promos"."max_discount_minor" > 0) and ("promos"."max_redemptions" is null or "promos"."max_redemptions" > 0) and ("promos"."max_per_customer" is null or "promos"."max_per_customer" > 0)),
	CONSTRAINT "promos_window_check" CHECK ("promos"."starts_at" is null or "promos"."expires_at" is null or "promos"."expires_at" > "promos"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_redemptions_promo_idx" ON "promo_redemptions" USING btree ("promo_id","profile_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE no action ON UPDATE no action;