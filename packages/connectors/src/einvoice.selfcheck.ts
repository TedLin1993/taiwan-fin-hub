// Run with: npx tsx packages/connectors/src/einvoice.selfcheck.ts
// Exercises the private official App endpoint contract without sending credentials.
import assert from "node:assert/strict";
import { EInvoiceClient } from "./tw-einvoice-api";

const requests: Array<{ url: string; init: RequestInit }> = [];

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (url: string, init: RequestInit) => {
  requests.push({ url, init });

  if (url.endsWith("User/Login")) {
    return json(
      {
        Result: {
          User: {
            Mobile: "0912345678",
            UserToken: "test-user-token",
            MobileBarcode: "/ABCD123"
          }
        }
      },
      "single"
    );
  }

  return json({ result: [] }, "mixed");
}) as typeof fetch;

async function main() {
  const client = new EInvoiceClient();
  await client.login({ mobile: "0912345678", password: "test-password" });

  assert.equal(client.currentUser?.mobile, "0912345678");
  assert.equal(client.currentUser?.userToken, "test-user-token");
  assert.equal(client.currentUser?.mobileBarcode, "/ABCD123");

  await client.checkCarrierInvoices({
    carrierId: "/ABCD123",
    carrierType: "3J0002",
    cardEncrypt: "test-password",
    startDate: "2026/07/01",
    endDate: "2026/07/31"
  });

  const loginHeaders = new Headers(requests[0]?.init.headers);
  assert.equal(loginHeaders.get("AppVersion"), "6.800.2");
  assert.equal(loginHeaders.get("OS"), "Android");
  assert.equal(loginHeaders.get("encrypt"), "single");
  assert.ok(loginHeaders.get("ApiKey"));

  const invoiceHeaders = new Headers(requests[1]?.init.headers);
  assert.equal(invoiceHeaders.get("encrypt"), "mixed");
  assert.equal(invoiceHeaders.get("Token"), "test-user-token");
  assert.equal(invoiceHeaders.get("CarrierCode"), "/ABCD123");

  assert.match(requests[0]?.url ?? "", /UIAPAPP\/api\/User\/Login$/);
  assert.match(requests[1]?.url ?? "", /UIAPAPP\/api\/Invoice\/ChkCarrierInv$/);
  console.log("einvoice.selfcheck: ok");
}

function json(body: unknown, encrypt: string) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", encrypt }
  });
}

main();
