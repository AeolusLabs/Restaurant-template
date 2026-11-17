import { z } from "zod";
import { formatIssues } from "./format-issues";

const pg = z.string().min(1);

const schema = z
  .object({
    DATABASE_URL: pg,
    DATABASE_UNPOOLED_URL: pg,
    DATABASE_SYSTEM_URL: pg,
    DATABASE_MIGRATOR_URL: pg,
    DATABASE_ADMIN_URL: pg.optional(),
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    APP_URL: z.url(),

    PAYMENT_PROVIDER: z.enum(["mock", "paystack"]).default("mock"),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_PUBLIC_KEY: z.string().optional(),

    DELIVERY_PROVIDER: z.enum(["mock", "chowdeck"]).default("mock"),
    CHOWDECK_API_KEY: z.string().optional(),
    CHOWDECK_BASE_URL: z.string().optional(),
    CHOWDECK_WEBHOOK_SECRET: z.string().optional(),

    NOTIFICATION_PROVIDER: z.enum(["stub"]).default("stub"),
    LLM_PROVIDER: z.enum(["mock"]).default("mock"),

    STORAGE_PROVIDER: z.enum(["memory", "s3"]).default("memory"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),

    TURNSTILE_SECRET_KEY: z.string().optional(),
    ORIGIN_LOCK_SECRET: z.string().optional(),

    INITIAL_OWNER_EMAIL: z.string().optional(),
    INITIAL_OWNER_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const need = (when: boolean, keys: (keyof typeof env)[]) => {
      if (!when) return;
      for (const key of keys) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "required for the selected provider" });
      }
    };
    need(env.PAYMENT_PROVIDER === "paystack", ["PAYSTACK_SECRET_KEY"]);
    need(env.DELIVERY_PROVIDER === "chowdeck", ["CHOWDECK_API_KEY", "CHOWDECK_BASE_URL"]);
    need(env.STORAGE_PROVIDER === "s3", ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]);
  });

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(`Invalid environment:\n${formatIssues(result.error.issues)}`);
}
