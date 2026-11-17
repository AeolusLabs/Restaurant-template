import { afterAll, describe, expect, inject, test } from "vitest";
import { closePools } from "../src/db/context";
import { completeMockPayment } from "../src/providers/payment/mock-checkout";
import { MockPaymentProvider } from "../src/providers/payment/mock";
import { PaystackProvider } from "../src/providers/payment/paystack";
import { startPayment } from "../src/payments/start-payment";
import { handlePaymentWebhook } from "../src/payments/webhook";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function pending() {
  const provider = new MockPaymentProvider();
  const user = await makeUser("customer");
  const { orderId } = await makeOrder(user.userId);
  const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
  const { reference } = await startPayment(user.ctx, code, { provider, email: "a@example.com", baseUrl: "http://localhost:3000", appUrl: urls.app, systemUrl: urls.system });
  const deliver = (raw: string, headers: Headers) => handlePaymentWebhook(raw, headers, { provider, systemUrl: urls.system });
  return { provider, reference, orderId, deliver };
}
const status = async (id: string) => (await admin().query(`select status from orders where id = $1`, [id])).rows[0].status;

describe("completeMockPayment", () => {
  test("a successful fake payment reaches the order through the real, signed webhook path", async () => {
    const p = await pending();
    await completeMockPayment(p.provider, { reference: p.reference, result: "success" }, p.deliver);
    expect(await status(p.orderId)).toBe("paid");
  });

  test("a failed fake payment leaves the order waiting for payment", async () => {
    const p = await pending();
    await completeMockPayment(p.provider, { reference: p.reference, result: "failed" }, p.deliver);
    expect(await status(p.orderId)).toBe("placed");
  });

  test("it refuses to run against a real payment provider", async () => {
    const real = new PaystackProvider({ secretKey: "sk_test_x" });
    await expect(completeMockPayment(real, { reference: "r", result: "success" }, async () => undefined)).rejects.toThrow(/PAYMENT_PROVIDER=mock/);
  });

  test("an unknown reference (for instance after a server restart) is a clear error", async () => {
    const p = await pending();
    await expect(completeMockPayment(new MockPaymentProvider(), { reference: p.reference, result: "success" }, p.deliver)).rejects.toThrow(/unknown reference/);
  });
});
