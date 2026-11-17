import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { PaystackProvider } from "../src/providers/payment/paystack";
import { PaymentProviderError, WebhookSignatureError } from "../src/providers/payment/types";

// Contract tests against a fake fetch. Nothing here has touched the real Paystack API: the request and
// response shapes are written from Paystack's public API as documented, and must be confirmed with a
// test key before launch (docs/phase-1-build-log.md "Not verified").

const SECRET = "sk_test_not_a_real_key_1234567890";
type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeFetch(respond: (call: Call) => { status?: number; json: unknown } | Error) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = respond(call);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}
const provider = (f: typeof fetch) => new PaystackProvider({ secretKey: SECRET, fetch: f });
const sign = (body: string, key = SECRET) => createHmac("sha512", key).update(body).digest("hex");

describe("PaystackProvider.initialize", () => {
  test("posts the amount in kobo, the reference and the callback, authorised with the secret key", async () => {
    const { fn, calls } = fakeFetch(() => ({
      json: { status: true, message: "ok", data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "abc", reference: "ref-1" } },
    }));
    const r = await provider(fn).initialize({ orderId: "o1", amountMinor: 1_241_625, email: "ada@example.com", reference: "ref-1", callbackUrl: "https://shop.example.com/orders/ABC234" });
    expect(r).toEqual({ authorizationUrl: "https://checkout.paystack.com/abc", reference: "ref-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/initialize");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0].body).toEqual({
      email: "ada@example.com",
      amount: 1_241_625,
      reference: "ref-1",
      callback_url: "https://shop.example.com/orders/ABC234",
      currency: "NGN",
      metadata: { order_id: "o1" },
    });
  });

  test("refuses an amount that is not a whole number of kobo before calling out", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: {} }));
    await expect(provider(fn).initialize({ orderId: "o", amountMinor: 10.5, email: "a@b.co", reference: "r", callbackUrl: "https://x" })).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  test("a refusal from Paystack becomes a PaymentProviderError with Paystack's message and no key", async () => {
    const { fn } = fakeFetch(() => ({ status: 400, json: { status: false, message: "Duplicate Transaction Reference" } }));
    const err = await provider(fn).initialize({ orderId: "o", amountMinor: 100, email: "a@b.co", reference: "r", callbackUrl: "https://x" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect(err.message).toContain("Duplicate Transaction Reference");
    expect(err.message).not.toContain(SECRET);
  });

  test("a network failure becomes a PaymentProviderError that does not leak the key", async () => {
    const { fn } = fakeFetch(() => new Error(`connect ECONNREFUSED while sending Bearer ${SECRET}`));
    const err = await provider(fn).initialize({ orderId: "o", amountMinor: 100, email: "a@b.co", reference: "r", callbackUrl: "https://x" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentProviderError);
    expect(err.message).not.toContain(SECRET);
  });

  test("a response in an unexpected shape is an error, not a crash later", async () => {
    const { fn } = fakeFetch(() => ({ json: { status: true, data: { nothing: "useful" } } }));
    await expect(provider(fn).initialize({ orderId: "o", amountMinor: 100, email: "a@b.co", reference: "r", callbackUrl: "https://x" })).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe("PaystackProvider.verify", () => {
  const reply = (status: string, amount = 100_000, currency = "NGN") => ({ json: { status: true, message: "Verification successful", data: { status, amount, currency, reference: "ref-1" } } });

  test("asks Paystack about the reference and returns the amount and currency it reports", async () => {
    const { fn, calls } = fakeFetch(() => reply("success", 1_241_625));
    expect(await provider(fn).verify("ref-1")).toEqual({ status: "success", amountMinor: 1_241_625, currency: "NGN" });
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/verify/ref-1");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  test("maps Paystack statuses onto success, failed and abandoned", async () => {
    const seen: Record<string, string> = {};
    for (const s of ["success", "failed", "reversed", "abandoned", "ongoing", "pending", "queued", "something-new"]) {
      seen[s] = (await provider(fakeFetch(() => reply(s)).fn).verify("ref-1")).status;
    }
    expect(seen).toEqual({
      success: "success",
      failed: "failed",
      reversed: "failed",
      abandoned: "abandoned",
      ongoing: "abandoned",
      pending: "abandoned",
      queued: "abandoned",
      "something-new": "abandoned", // unknown never counts as paid
    });
  });

  test("encodes the reference in the path", async () => {
    const { fn, calls } = fakeFetch(() => reply("success"));
    await provider(fn).verify("a/b c");
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/verify/a%2Fb%20c");
  });

  test("an amount that is not an integer is rejected", async () => {
    await expect(provider(fakeFetch(() => reply("success", 10.5)).fn).verify("r")).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe("PaystackProvider.parseWebhook", () => {
  const body = JSON.stringify({ event: "charge.success", data: { id: 302961, reference: "ref-1", amount: 100_000, currency: "NGN", status: "success" } });
  const p = provider(fakeFetch(() => ({ json: {} })).fn);
  const headers = (sig?: string) => new Headers(sig === undefined ? {} : { "x-paystack-signature": sig });

  test("accepts a body signed with HMAC-SHA512 of the raw bytes and the secret key", () => {
    expect(p.parseWebhook(body, headers(sign(body)))).toEqual({
      id: "charge.success:ref-1",
      type: "charge.success",
      reference: "ref-1",
      amountMinor: 100_000,
      raw: JSON.parse(body),
    });
  });

  test("rejects a missing signature, a wrong one, one from another key, and one for a different body", () => {
    for (const h of [headers(), headers("deadbeef"), headers(sign(body, "sk_test_other")), headers(sign(body + " "))]) {
      expect(() => p.parseWebhook(body, h)).toThrow(WebhookSignatureError);
    }
  });

  test("the signature covers the exact bytes: a reformatted body fails even with the same content", () => {
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    expect(() => p.parseWebhook(reformatted, headers(sign(body)))).toThrow(WebhookSignatureError);
  });

  test("a signed body that is not JSON is not a signature error", () => {
    const junk = "{not json";
    expect(() => p.parseWebhook(junk, headers(sign(junk)))).toThrow(SyntaxError);
  });

  test("the same payment gives the same event id however many times Paystack sends it", () => {
    const again = JSON.stringify({ event: "charge.success", data: { id: 999, reference: "ref-1", amount: 100_000 } });
    expect(p.parseWebhook(again, headers(sign(again))).id).toBe("charge.success:ref-1");
  });

  test("events we do not handle are reported as unknown, not rejected", () => {
    const other = JSON.stringify({ event: "transfer.success", data: { id: 5, reference: "tr-1" } });
    expect(p.parseWebhook(other, headers(sign(other)))).toMatchObject({ type: "unknown", reference: "tr-1" });
    const refund = JSON.stringify({ event: "refund.processed", data: { id: 77, transaction_reference: "ref-1", amount: 500 } });
    expect(p.parseWebhook(refund, headers(sign(refund)))).toMatchObject({ type: "refund.processed", reference: "ref-1", id: "refund.processed:77" });
  });
});

describe("PaystackProvider.refund", () => {
  test("asks Paystack to refund the transaction by reference, in kobo, and returns its refund id", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { status: true, message: "Refund has been queued for processing", data: { id: 4242, status: "pending" } } }));
    const r = await provider(fn).refund({ reference: "ref-1", amountMinor: 50_000, reason: "Customer cancelled" });
    expect(r).toEqual({ providerRef: "4242" });
    expect(calls[0].url).toBe("https://api.paystack.co/refund");
    expect(calls[0].body).toEqual({ transaction: "ref-1", amount: 50_000, currency: "NGN", merchant_note: "Customer cancelled" });
  });

  test("a refusal becomes a PaymentProviderError", async () => {
    const { fn } = fakeFetch(() => ({ status: 400, json: { status: false, message: "Transaction has already been fully reversed" } }));
    await expect(provider(fn).refund({ reference: "r", amountMinor: 1 })).rejects.toThrow(/fully reversed/);
  });
});

describe("PaystackProvider setup", () => {
  test("is named paystack, and refuses an empty secret key", () => {
    expect(provider(fakeFetch(() => ({ json: {} })).fn).name).toBe("paystack");
    expect(() => new PaystackProvider({ secretKey: "" })).toThrow(/secret key/i);
  });
});
