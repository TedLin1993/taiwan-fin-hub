import { describe, expect, it, vi } from "vitest";
import { ocrRoutes } from "../../../src/features/ocr/route";
import type { Env } from "../../../src/platform/env";

function envWithResponse(content: string) {
  return {
    AI: {
      run: vi.fn().mockResolvedValue({
        choices: [{ message: { content } }],
      }),
    },
  } as unknown as Env;
}

describe("POST /ocr/validate-number", () => {
  it("returns the Gemma 4 result for a JPEG body", async () => {
    const response = await ocrRoutes.request(
      "/ocr/validate-number",
      {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array([1, 2, 3]),
      },
      envWithResponse("575831"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      number: "575831",
      model: "@cf/google/gemma-4-26b-a4b-it",
    });
  });

  it("returns 422 when Gemma does not return exactly six digits", async () => {
    const response = await ocrRoutes.request(
      "/ocr/validate-number",
      {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: new Uint8Array([1, 2, 3]),
      },
      envWithResponse("I cannot read it"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OCR_FAILED" },
    });
  });
});
