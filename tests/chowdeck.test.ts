import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ChowdeckProvider } from "../src/providers/delivery/chowdeck";
import { DeliveryProviderError, DuplicateDeliveryError, InsufficientWalletError, QuoteExpiredError, type DeliveryCreateInput } from "../src/providers/delivery/types";
import { WebhookSignatureError } from "../src/providers/payment/types";

// Contract tests against a fake fetch. Nothing here has touched the real Chowdeck API. The request and response
// shapes come from Chowdeck's own documentation (chowdeck-api.readme.io, read 2026-11-18), which disagrees with
// itself in places; every such place is covered by a test that says what the adapter does about it. All of it
// must be confirmed with a live key before launch (docs/phase-4-build-log.md "Not verified").

const KEY = "ck_test_not_a_real_key_1234567890";
const SECRET = "whsec_not_a_real_secret";
const BASE = "https://relay.example.test";
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
const provider = (f: typeof fetch, over: Partial<ConstructorParameters<typeof ChowdeckProvider>[0]> = {}) =>
  new ChowdeckProvider({ apiKey: KEY, baseUrl: BASE, webhookSecret: SECRET, fetch: f, ...over });
const refused = (message: string, status = 400) => fakeFetch(() => ({ status, json: { message } }));

const trip = {
  pickup: { name: "Test Kitchen", phone: "08030000000", address: "1 Marina Road, Lagos" },
  dropoff: { name: "Ada Lovelace", phone: "+2348031112222", address: "12 Admiralty Way, Lekki" },
  orderValueMinor: 1_000_000,
};
const create: DeliveryCreateInput = { ...trip, quoteId: "9001", reference: "ABC234-1-1", note: "Landmark: Blue gate" };

describe("ChowdeckProvider set-up", () => {
  test("needs an API key and a base URL, because there is no default host", () => {
    const { fn } = fakeFetch(() => ({ json: {} }));
    expect(() => new ChowdeckProvider({ apiKey: "", baseUrl: BASE, fetch: fn })).toThrow(/CHOWDECK_API_KEY/);
    expect(() => new ChowdeckProvider({ apiKey: KEY, baseUrl: "", fetch: fn })).toThrow(/CHOWDECK_BASE_URL/);
  });

  test("a trailing slash on the base URL does not double up", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { data: { balance: 5 } } }));
    await provider(fn, { baseUrl: `${BASE}/` }).getWalletBalance();
    expect(calls[0].url).toBe(`${BASE}/relay/wallet/balance`);
  });
});

describe("getQuote", () => {
  test("asks for a fee by address and returns the fee id as the quote, in kobo", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { data: { id: 9001, total_amount: 150_000 } } }));
    const q = await provider(fn).getQuote(trip);
    expect(q).toEqual({ quoteId: "9001", feeMinor: 150_000 });
    expect(calls[0]).toMatchObject({ url: `${BASE}/relay/delivery/fee`, method: "POST" });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({
      source_address_string: "1 Marina Road, Lagos",
      destination_address_string: "12 Admiralty Way, Lekki",
      estimated_order_amount: 1_000_000,
    });
  });

  test("a quote has no stated lifetime, so none is claimed", async () => {
    const { fn } = fakeFetch(() => ({ json: { data: { id: 1, total_amount: 1 } } }));
    expect((await provider(fn).getQuote(trip)).expiresAt).toBeUndefined();
  });

  test("a response without a usable fee is an error, never a free delivery", async () => {
    for (const data of [{ id: 1 }, { total_amount: 100 }, { id: 1, total_amount: "lots" }, { id: 1, total_amount: 10.5 }]) {
      const { fn } = fakeFetch(() => ({ json: { data } }));
      await expect(provider(fn).getQuote(trip)).rejects.toBeInstanceOf(DeliveryProviderError);
    }
  });
});

describe("createDelivery", () => {
  const ok = { data: { reference: "ABC234-1-1", delivery_price: 150_000, status: "pending", tracking_url: "https://track.example.test/x" } };

  test("books with the fee id, both contacts, our reference and the note", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: ok }));
    const r = await provider(fn).createDelivery(create);
    expect(r).toEqual({ providerRef: "ABC234-1-1", status: "pending", trackingUrl: "https://track.example.test/x", costMinor: 150_000 });
    expect(calls[0]).toMatchObject({ url: `${BASE}/relay/delivery`, method: "POST" });
    expect(calls[0].body).toEqual({
      fee_id: 9001,
      item_type: "food",
      user_action: "sending",
      source_contact: { name: "Test Kitchen", phone: "08030000000", country_code: "+234" },
      destination_contact: { name: "Ada Lovelace", phone: "+2348031112222", country_code: "+234" },
      reference: "ABC234-1-1",
      estimated_order_amount: 1_000_000,
      customer_delivery_note: "Landmark: Blue gate",
    });
  });

  test("finds the tracking link whether it sits beside the data or inside it", async () => {
    const beside = fakeFetch(() => ({ json: { data: { reference: "r", delivery_price: 1, status: "pending" }, tracking_url: "https://track.example.test/beside" } }));
    expect((await provider(beside.fn).createDelivery(create)).trackingUrl).toBe("https://track.example.test/beside");
    const none = fakeFetch(() => ({ json: { data: { reference: "r", delivery_price: 1, status: "pending" } } }));
    expect((await provider(none.fn).createDelivery(create)).trackingUrl).toBeUndefined();
  });

  test("a tracking link that is not a web address is dropped, not shown to a customer", async () => {
    const { fn } = fakeFetch(() => ({ json: { data: { reference: "r", delivery_price: 1, status: "pending", tracking_url: "javascript:alert(1)" } } }));
    expect((await provider(fn).createDelivery(create)).trackingUrl).toBeUndefined();
  });

  test("a fee id that is not a number is refused before calling out", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: ok }));
    await expect(provider(fn).createDelivery({ ...create, quoteId: "not-a-number" })).rejects.toBeInstanceOf(DeliveryProviderError);
    expect(calls).toHaveLength(0);
  });

  test("an expired fee becomes QuoteExpiredError so dispatch can re-quote", async () => {
    await expect(provider(refused("This delivery fee has expired").fn).createDelivery(create)).rejects.toBeInstanceOf(QuoteExpiredError);
  });

  test("a repeated reference becomes DuplicateDeliveryError so dispatch can adopt the booking", async () => {
    await expect(provider(refused("Possible duplicate order. Please send unique reference").fn).createDelivery(create)).rejects.toBeInstanceOf(DuplicateDeliveryError);
  });

  test("an empty wallet becomes InsufficientWalletError (the real wording is not documented, so several are recognised)", async () => {
    for (const m of ["Insufficient funds in wallet", "insufficient wallet balance", "Your balance is too low"]) {
      await expect(provider(refused(m).fn).createDelivery(create)).rejects.toBeInstanceOf(InsufficientWalletError);
    }
    await expect(provider(refused("Payment required", 402).fn).createDelivery(create)).rejects.toBeInstanceOf(InsufficientWalletError);
  });

  test("any other refusal is a plain DeliveryProviderError carrying Chowdeck's message and never the key", async () => {
    const err = await provider(refused("Destination out of range", 422).fn).createDelivery(create).catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryProviderError);
    expect(err).not.toBeInstanceOf(InsufficientWalletError);
    expect(err.message).toContain("Destination out of range");
    expect(err.message).not.toContain(KEY);
  });

  test("an unreachable provider and an unreadable reply are both DeliveryProviderErrors", async () => {
    await expect(provider(fakeFetch(() => new Error(`connect ECONNREFUSED ${KEY}`)).fn).createDelivery(create)).rejects.toThrow(/could not be reached/);
    const html = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    await expect(provider(html).createDelivery(create)).rejects.toBeInstanceOf(DeliveryProviderError);
  });
});

describe("status words", () => {
  // The guide and the webhook page use different words for the same stages. Every word either page uses is mapped;
  // anything else is "unknown", which is never treated as delivered.
  const cases: [string, string][] = [
    ["pending", "pending"],
    ["preparing", "pending"],
    ["awaiting_pickup", "awaiting_pickup"],
    ["accepted", "awaiting_pickup"],
    ["picked", "in_transit"],
    ["in_transit", "in_transit"],
    ["arrived", "in_transit"],
    ["success", "delivered"],
    ["completed", "delivered"],
    ["cancelled", "cancelled"],
    ["rejected", "failed"],
    ["teleported", "unknown"],
    ["", "unknown"],
  ];
  test.each(cases)("%s is read as %s", async (word, expected) => {
    const { fn } = fakeFetch(() => ({ json: { data: { status: word, tracking_url: "https://t.example.test/x" } } }));
    expect((await provider(fn).getDelivery("ABC234-1-1")).status).toBe(expected);
  });

  test("it ignores case and surrounding spaces, and a missing status is unknown", async () => {
    const a = fakeFetch(() => ({ json: { data: { status: "  In_Transit " } } }));
    expect((await provider(a.fn).getDelivery("r")).status).toBe("in_transit");
    const b = fakeFetch(() => ({ json: { data: {} } }));
    expect((await provider(b.fn).getDelivery("r")).status).toBe("unknown");
  });
});

describe("getDelivery, cancel and wallet", () => {
  test("looks a delivery up by reference, escaped", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { data: { status: "pending" } } }));
    await provider(fn).getDelivery("A/B C");
    expect(calls[0]).toMatchObject({ url: `${BASE}/relay/delivery/A%2FB%20C`, method: "GET" });
  });

  test("cancels with a reason", async () => {
    const { fn, calls } = fakeFetch(() => ({ json: { data: {} } }));
    expect(await provider(fn).cancel("ABC234-1-1", "Order cancelled")).toEqual({});
    expect(calls[0]).toMatchObject({ url: `${BASE}/relay/delivery/ABC234-1-1/cancel`, method: "POST", body: { reason: "Order cancelled" } });
  });

  test("a cancel the provider refuses is an error, so the caller raises an alert", async () => {
    await expect(provider(refused("Cannot cancel a delivery in transit").fn).cancel("r", "x")).rejects.toBeInstanceOf(DeliveryProviderError);
  });

  test("reads the wallet balance in kobo", async () => {
    const { fn } = fakeFetch(() => ({ json: { data: { balance: 2_500_000 } } }));
    expect(await provider(fn).getWalletBalance()).toEqual({ balanceMinor: 2_500_000 });
  });

  test("a balance that is not a whole number of kobo is an error, never guessed", async () => {
    for (const balance of [12.5, "plenty", undefined]) {
      const { fn } = fakeFetch(() => ({ json: { data: { balance } } }));
      await expect(provider(fn).getWalletBalance()).rejects.toBeInstanceOf(DeliveryProviderError);
    }
  });
});

describe("parseWebhook", () => {
  const sign = (body: string, key = SECRET) => createHmac("sha256", key).update(body).digest("hex");
  const headers = (sig: string) => new Headers({ "x-chowdeck-signature": sig });
  const p = () => provider(fakeFetch(() => ({ json: {} })).fn);

  test("a correctly signed event gives the delivery's reference and status", () => {
    const body = JSON.stringify({ id: "evt-1", event: "delivery.updated", data: { reference: "ABC234-1-1", status: "picked" } });
    expect(p().parseWebhook(body, headers(sign(body)))).toMatchObject({ id: "evt-1", providerRef: "ABC234-1-1", status: "in_transit" });
  });

  test("reads a flat body as well as one wrapped in data", () => {
    const body = JSON.stringify({ reference: "ABC234-1-1", status: "completed" });
    expect(p().parseWebhook(body, headers(sign(body)))).toMatchObject({ providerRef: "ABC234-1-1", status: "delivered" });
  });

  test("with no event id the identity is the reference and status, so a replay is recognised", () => {
    const body = JSON.stringify({ data: { reference: "ABC234-1-1", status: "picked" } });
    const a = p().parseWebhook(body, headers(sign(body)));
    const b = p().parseWebhook(body, headers(sign(body)));
    expect(a.id).toBe(b.id);
    expect(a.id).toContain("ABC234-1-1");
  });

  test("a wrong, missing or differently keyed signature is refused", () => {
    const body = JSON.stringify({ data: { reference: "r", status: "success" } });
    for (const sig of ["00".repeat(32), "", sign(body, "another-secret")]) {
      expect(() => p().parseWebhook(body, headers(sig))).toThrow(WebhookSignatureError);
    }
    expect(() => p().parseWebhook(body, new Headers())).toThrow(WebhookSignatureError);
  });

  test("with no webhook secret configured every webhook is refused, and polling carries on alone", () => {
    const body = JSON.stringify({ data: { reference: "r", status: "success" } });
    const noSecret = provider(fakeFetch(() => ({ json: {} })).fn, { webhookSecret: undefined });
    expect(() => noSecret.parseWebhook(body, headers(sign(body)))).toThrow(WebhookSignatureError);
  });

  test("a signed body with no reference is a bad payload, not a signature failure", () => {
    const body = JSON.stringify({ data: { status: "success" } });
    expect(() => p().parseWebhook(body, headers(sign(body)))).toThrow();
    expect(() => p().parseWebhook(body, headers(sign(body)))).not.toThrow(WebhookSignatureError);
  });

  test("an unknown status word comes through as unknown, never delivered", () => {
    const body = JSON.stringify({ data: { reference: "r", status: "teleported" } });
    expect(p().parseWebhook(body, headers(sign(body))).status).toBe("unknown");
  });
});
