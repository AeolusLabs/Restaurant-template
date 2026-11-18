CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"autonomy" text DEFAULT 'suggest_only' NOT NULL,
	"auto_confirmed_at" timestamp with time zone,
	"auto_confirmed_by" uuid,
	"monthly_cap_minor" bigint,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_agent_key_unique" UNIQUE("agent_key"),
	CONSTRAINT "agent_configs_autonomy_check" CHECK ("agent_configs"."autonomy" in ('suggest_only', 'approve_first', 'auto')),
	CONSTRAINT "agent_configs_cap_check" CHECK ("agent_configs"."monthly_cap_minor" is null or "agent_configs"."monthly_cap_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"customer_facing" boolean NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedupe_key" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proposals_mode_check" CHECK ("agent_proposals"."mode" in ('advice', 'approve', 'auto')),
	CONSTRAINT "agent_proposals_status_check" CHECK ("agent_proposals"."status" in ('pending', 'approved', 'rejected', 'executed', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"agent_key" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"model" text,
	"proposals" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_by" uuid,
	CONSTRAINT "agent_runs_trigger_check" CHECK ("agent_runs"."trigger" in ('schedule', 'manual', 'inbound')),
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" in ('running', 'succeeded', 'failed', 'refused_cap', 'skipped')),
	CONSTRAINT "agent_runs_nonneg_check" CHECK ("agent_runs"."input_tokens" >= 0 and "agent_runs"."output_tokens" >= 0 and "agent_runs"."cost_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_proposals_status_idx" ON "agent_proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_agent_idx" ON "agent_proposals" USING btree ("agent_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_proposals_open_dedupe" ON "agent_proposals" USING btree ("agent_key","dedupe_key") WHERE "agent_proposals"."dedupe_key" is not null and "agent_proposals"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_key","started_at");