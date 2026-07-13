// Run with: npx tsx packages/connectors/src/einvoice.selfcheck.ts
// Exercises the public MOF API contract end-to-end: barcode login -> invoice headers -> details.
import assert from "node:assert/strict";
import { einvoiceConnector, parseInvoiceConfig } from "./index";
import { EInvoiceClient } from "./tw-einvoice-api";

const requests: URLSearchParams[] = [];

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (_url: string, init: RequestInit) => {
  const body = new URLSearchParams(String(init.body));
  requests.push(body);

  if (body.get("appID") === "SUSPENDED") {
    return json({ code: 998, msg: "appID 不符合規定 (停權或尚未申請)" });
  }

  if (body.get("action") === "getBarcode") {
    assert.equal(body.get("version"), "2.0");
    assert.equal(body.get("phoneNo"), "0912345678");
    assert.equal(body.get("verificationCode"), "barcode-password");
    return json({ code: 200, msg: "執行成功", cardNo: "/ABCD123" });
  }

  if (body.get("action") === "carrierInvChk") {
    assert.equal(body.get("version"), "0.6");
    assert.equal(body.get("cardType"), "3J0002");
    assert.equal(body.get("cardNo"), "/ABCD123");
    assert.equal(body.get("cardEncrypt"), "barcode-password");
    if (body.get("appID") === "PAGED-APP-ID") {
      const page = body.get("page");
      return json({
        code: page === "1" ? 996 : 200,
        msg: "執行成功",
        details: [
          {
            invNum: page === "1" ? "BB12345678" : "CC12345678",
            invDate: "20260709",
            sellerName: "分頁測試商店",
            amount: "10"
          }
        ]
      });
    }
    return json({
      code: 200,
      msg: "執行成功",
      details: [
        {
          invNum: "AA12345678",
          invDate: { year: 126, month: 6, date: 8 },
          sellerName: "測試商店",
          amount: "120"
        }
      ]
    });
  }

  if (body.get("action") === "carrierInvDetail") {
    assert.equal(body.get("version"), "0.5");
    assert.equal(body.get("invNum"), "AA12345678");
    assert.equal(body.get("invDate"), "2026/07/08");
    return json({
      code: 200,
      msg: "執行成功",
      invNum: "AA12345678",
      details: [
        {
          rowNum: "1",
          description: "咖啡",
          quantity: "2",
          unitPrice: "60",
          amount: "120"
        }
      ]
    });
  }

  throw new Error(`Unexpected action: ${body.get("action")}`);
}) as typeof fetch;

async function main() {
  const config = parseInvoiceConfig({
    mobile: "0912345678",
    password: "barcode-password",
    appId: "VALID-APP-ID",
    periodsBack: 1,
    fetchDetails: true
  });
  const result = await einvoiceConnector.sync(config, undefined);

  assert.equal(config.mobileBarcode, "/ABCD123", "login should persist the returned mobile barcode");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.sourceId, "AA12345678:2026/07/08");
  assert.equal(result.records[0]?.sellerName, "測試商店");
  assert.equal(result.records[0]?.amount, 120);
  assert.equal(result.invoiceLineItems?.length, 1);
  assert.equal(result.invoiceLineItems?.[0]?.description, "咖啡");
  assert.equal(result.invoiceLineItems?.[0]?.amount, 120);
  assert.deepEqual(
    requests.map((request) => request.get("action")),
    ["getBarcode", "carrierInvChk", "carrierInvDetail"]
  );

  const paged = await new EInvoiceClient({ appId: "PAGED-APP-ID" }).checkCarrierInvoices({
    carrierId: "/ABCD123",
    cardEncrypt: "barcode-password",
    startDate: "2026/07/01",
    endDate: "2026/07/31"
  });
  assert.equal(paged.result.length, 2, "code 996 should fetch and combine the next page");
  assert.deepEqual(
    requests.slice(-2).map((request) => request.get("page")),
    ["1", "2"]
  );

  await assert.rejects(
    new EInvoiceClient({ appId: "SUSPENDED" }).login({
      mobile: "0912345678",
      password: "barcode-password"
    }),
    /電子發票 API 998.*appID 不符合規定/
  );
  await assert.rejects(
    new EInvoiceClient().login({ mobile: "0912345678", password: "barcode-password" }),
    /尚未設定財政部電子發票 AppID/
  );

  console.log("einvoice.selfcheck: ok");
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

main();
