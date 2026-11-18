CREATE TABLE "qr_scans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source_id" uuid NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_sources_slug_unique" UNIQUE("slug"),
	CONSTRAINT "qr_sources_slug_check" CHECK ("qr_sources"."slug" ~ '^[abcdefghjkmnpqrstuvwxyz23456789]{8}$'),
	CONSTRAINT "qr_sources_label_check" CHECK (char_length(btrim("qr_sources"."label")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_source_id_qr_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."qr_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qr_scans_source_idx" ON "qr_scans" USING btree ("source_id","scanned_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_id_qr_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."qr_sources"("id") ON DELETE no action ON UPDATE no action;