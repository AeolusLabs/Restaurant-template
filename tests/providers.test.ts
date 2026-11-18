import { describe, expect, test } from "vitest";
import { z } from "zod";
import { loadEnv } from "../src/lib/env";
import { getProviders } from "../src/providers";
import { registerProvider } from "../src/providers/registry";
import { WebhookSignatureError } from "../src/providers/payment/types";
import { PaystackProvider } from "../src/providers/payment/paystack";
import { MockPaymentProvider, signMockWebhook } from "../src/providers/payment/mock";
import { ChowdeckProvider } from "../src/providers/delivery/chowdeck";
import { MockDeliveryProvider, signMockDeliveryWebhook } from "../src/providers/delivery/mock";
import { DeliveryProviderError, InsufficientWalletError, QuoteExpiredError, type DeliveryQuoteInput } from "../src/providers/delivery/types";
import { StubNotificationProvider } from "../src/providers/notification/stub";
import { MockLLMProvider } from "../src/providers/llm/mock";
import { MemoryStorageProvider } from "../src/providers/storage/memory";

const baseEnv = {
  DATABASE_URL: "postgres://a:b@localhost/x",
  DATABASE_UNPOOLED_URL: "postgres://a:b@localhost/x",
  DATABASE_SYSTEM_URL: "postgres://a:b@localhost/x",
  DATABASE_MIGRATOR_URL: "postgres://a:b@localhost/x",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("provider registry", () => {
  test("getProviders defaults every provider to its local fake", () => {
    const p = getProviders(loadEnv(baseEnv));
    expect(p.payment).toBeInstanceOf(MockPaymentProvider);
    expect(p.delivery).toBeInstanceOf(MockDeliveryProvider);
    expect(p.notification).toBeInstanceOf(StubNotificationProvider);
    expect(p.llm).toBeInstanceOf(MockLLMProvider);
    expect(p.storage).toBeInstanceOf(MemoryStorageProvider);
  });

  test("selecting paystack builds the Paystack adapter from the secret key", () => {
    const env = loadEnv({ ...baseEnv, PAYMENT_PROVIDER: "paystack", PAYSTACK_SECRET_KEY: "sk_test_x" });
    expect(getProviders(env).payment).toBeInstanceOf(PaystackProvider);
  });

  test("selecting chowdeck builds the Chowdeck adapter from the key and base URL", () => {
    const d = loadEnv({ ...baseEnv, DELIVERY_PROVIDER: "chowdeck", CHOWDECK_API_KEY: "k", CHOWDECK_BASE_URL: "https://x" });
    expect(getProviders(d).delivery).toBeInstanceOf(ChowdeckProvider);
  });

  test("selecting s3 with no adapter names the right file", () => {
    const s = loadEnv({ ...baseEnv, STORAGE_PROVIDER: "s3", S3_ENDPOINT: "https://x", S3_BUCKET: "b", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s" });
    expect(() => getProviders(s)).toThrow(/src\/providers\/storage\/s3\.ts/);
  });

  test("a provider registered at runtime is selected by name", () => {
    const fake = new MockPaymentProvider();
    registerProvider("payment", "paystack", () => fake);
    const env = loadEnv({ ...baseEnv, PAYMENT_PROVIDER: "paystack", PAYSTACK_SECRET_KEY: "sk_test_x" });
    expect(getProviders(env).payment).toBe(fake);
  });
});

describe("mock payment provider", () => {
  test("initialize returns an authorization URL and echoes the reference", async () => {
    const p = new MockPaymentProvider();
    const r = await p.initialize({ orderId: "o1", amountMinor: 350_000, email: "a@b.co", reference: "ref-1", callbackUrl: "http://x/cb" });
    expect(r.reference).toBe("ref-1");
    // The mock "payment page" is a screen in this app, so the whole purchase can be tried locally.
    expect(r.authorizationUrl).toBe("http://x/mock-pay/ref-1");
  });

  test("verify reflects simulatePayment and the initialised amount", async () => {
    const p = new MockPaymentProvider();
    await p.initialize({ orderId: "o1", amountMinor: 350_000, email: "a@b.co", reference: "ref-2", callbackUrl: "http://x" });
    expect(await p.verify("ref-2")).toEqual({ status: "abandoned", amountMinor: 350_000, currency: "NGN" });
    p.simulatePayment("ref-2", "success");
    expect((await p.verify("ref-2")).status).toBe("success");
    await expect(p.verify("never-initialised")).rejects.toThrow(/unknown reference/);
  });

  test("parseWebhook accepts a body signed with signMockWebhook and rejects a tampered body", () => {
    const p = new MockPaymentProvider();
    const body = JSON.stringify({ id: "evt-1", event: "charge.success", data: { reference: "ref-3", amount: 350_000 } });
    const good = new Headers({ "x-mock-signature": signMockWebhook(body) });
    expect(p.parseWebhook(body, good)).toMatchObject({ id: "evt-1", type: "charge.success", reference: "ref-3", amountMinor: 350_000 });
    expect(() => p.parseWebhook(body.replace("350000", "1"), good)).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook(body, new Headers())).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook(body, new Headers({ "x-mock-signature": "00" }))).toThrow(WebhookSignatureError);
  });

  test("refund returns a provider reference and is recorded", async () => {
    const p = new MockPaymentProvider();
    const r = await p.refund({ reference: "ref-4", amountMinor: 100 });
    expect(r.providerRef).toMatch(/^mock-refund-/);
    expect(p.refunds).toHaveLength(1);
  });
});

const trip: DeliveryQuoteInput = {
  pickup: { name: "Kitchen", phone: "08000000000", address: "1 Sample Street" },
  dropoff: { name: "Ada", phone: "08011111111", address: "9 Customer Road" },
};

describe("mock delivery provider", () => {
  test("quote then create returns a provider reference and charges the wallet", async () => {
    const d = new MockDeliveryProvider({ feeMinor: 150_000, walletMinor: 1_000_000 });
    const q = await d.getQuote(trip);
    expect(q.feeMinor).toBe(150_000);
    const c = await d.createDelivery({ ...trip, quoteId: q.quoteId, reference: "r1" });
    expect(c.providerRef).toMatch(/^mock-del-/);
    expect(c.status).toBe("pending");
    expect(c.costMinor).toBe(150_000);
    expect((await d.getWalletBalance()).balanceMinor).toBe(850_000);
  });

  test("failNextCreate makes only the next create reject", async () => {
    const d = new MockDeliveryProvider();
    d.failNextCreate();
    const q1 = await d.getQuote(trip);
    await expect(d.createDelivery({ ...trip, quoteId: q1.quoteId, reference: "a" })).rejects.toBeInstanceOf(DeliveryProviderError);
    const q2 = await d.getQuote(trip);
    await expect(d.createDelivery({ ...trip, quoteId: q2.quoteId, reference: "b" })).resolves.toBeDefined();
  });

  test("an expired or unknown quote is rejected with QuoteExpiredError", async () => {
    const d = new MockDeliveryProvider();
    const q = await d.getQuote(trip);
    d.expireQuote(q.quoteId);
    await expect(d.createDelivery({ ...trip, quoteId: q.quoteId, reference: "x" })).rejects.toBeInstanceOf(QuoteExpiredError);
    await expect(d.createDelivery({ ...trip, quoteId: "nope", reference: "y" })).rejects.toBeInstanceOf(QuoteExpiredError);
  });

  test("an empty wallet rejects the create with InsufficientWalletError", async () => {
    const d = new MockDeliveryProvider({ feeMinor: 150_000, walletMinor: 100 });
    const q = await d.getQuote(trip);
    await expect(d.createDelivery({ ...trip, quoteId: q.quoteId, reference: "z" })).rejects.toBeInstanceOf(InsufficientWalletError);
  });

  test("advance walks pending to awaiting_pickup to in_transit to delivered and stops", async () => {
    const d = new MockDeliveryProvider();
    const q = await d.getQuote(trip);
    const { providerRef } = await d.createDelivery({ ...trip, quoteId: q.quoteId, reference: "w" });
    const seen = [d.advance(providerRef), d.advance(providerRef), d.advance(providerRef), d.advance(providerRef)];
    expect(seen).toEqual(["awaiting_pickup", "in_transit", "delivered", "delivered"]);
    expect((await d.getDelivery(providerRef)).status).toBe("delivered");
  });

  test("cancel refunds the wallet, and a delivered order cannot be cancelled", async () => {
    const d = new MockDeliveryProvider({ feeMinor: 100, walletMinor: 1000 });
    const q = await d.getQuote(trip);
    const a = await d.createDelivery({ ...trip, quoteId: q.quoteId, reference: "c1" });
    expect(await d.cancel(a.providerRef, "customer changed mind")).toEqual({ refundMinor: 100 });
    expect((await d.getWalletBalance()).balanceMinor).toBe(1000);
    const q2 = await d.getQuote(trip);
    const b = await d.createDelivery({ ...trip, quoteId: q2.quoteId, reference: "c2" });
    for (let i = 0; i < 3; i++) d.advance(b.providerRef);
    await expect(d.cancel(b.providerRef, "too late")).rejects.toBeInstanceOf(DeliveryProviderError);
  });

  test("the wallet balance is settable", async () => {
    const d = new MockDeliveryProvider();
    d.setWalletBalance(42);
    expect(await d.getWalletBalance()).toEqual({ balanceMinor: 42 });
  });

  test("parseWebhook verifies the signature and maps the status", () => {
    const d = new MockDeliveryProvider();
    const body = JSON.stringify({ id: "e1", reference: "mock-del-1", status: "in_transit" });
    const ok = d.parseWebhook(body, new Headers({ "x-mock-signature": signMockDeliveryWebhook(body) }));
    expect(ok).toMatchObject({ id: "e1", providerRef: "mock-del-1", status: "in_transit" });
    expect(() => d.parseWebhook(body, new Headers({ "x-mock-signature": "bad" }))).toThrow();
  });
});

describe("notification stub", () => {
  test("records the message instead of sending it", async () => {
    const n = new StubNotificationProvider();
    await n.send({ channel: "whatsapp", to: "+2348000000000", template: "order_ready", vars: { code: "AB12" } });
    expect(n.sent).toEqual([{ channel: "whatsapp", to: "+2348000000000", template: "order_ready", vars: { code: "AB12" } }]);
  });
});

describe("mock llm provider", () => {
  const schema = z.object({ summary: z.string(), score: z.number() });

  test("returns the canned output when it passes the caller's schema, with token usage", async () => {
    const llm = new MockLLMProvider();
    llm.respondWith({ summary: "ok", score: 3 });
    const r = await llm.complete({ system: "You are a planner.", messages: [{ role: "user", content: "Plan Friday." }], schema, maxOutputTokens: 200 });
    expect(r.output).toEqual({ summary: "ok", score: 3 });
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
  });

  test("usage is deterministic for the same input", async () => {
    const run = async () => {
      const llm = new MockLLMProvider();
      llm.respondWith({ summary: "ok", score: 3 });
      return (await llm.complete({ system: "s", messages: [{ role: "user", content: "m" }], schema, maxOutputTokens: 10 })).usage;
    };
    expect(await run()).toEqual(await run());
  });

  test("an output that fails the schema is an error, not a silent pass", async () => {
    const llm = new MockLLMProvider();
    llm.respondWith({ summary: 1 });
    await expect(llm.complete({ system: "s", messages: [], schema, maxOutputTokens: 10 })).rejects.toThrow();
  });
});

describe("memory storage", () => {
  test("put then getStream round-trips bytes and the content type", async () => {
    const s = new MemoryStorageProvider();
    await s.put("menu/jollof.jpg", new Uint8Array([1, 2, 3]), "image/jpeg");
    const got = await s.getStream("menu/jollof.jpg");
    expect(got?.contentType).toBe("image/jpeg");
    expect(new Uint8Array(await new Response(got!.stream).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("a missing key returns null, and delete removes a key", async () => {
    const s = new MemoryStorageProvider();
    expect(await s.getStream("nope")).toBeNull();
    await s.put("k", new Uint8Array([9]), "application/octet-stream");
    await s.delete("k");
    expect(await s.getStream("k")).toBeNull();
  });
});
