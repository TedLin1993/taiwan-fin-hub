import { describe, expect, it, vi } from "vitest";
import {
  recognizeValidateNumber,
  VALIDATE_NUMBER_MODEL,
  ValidateNumberOcrError,
  ValidateNumberOcrUnavailableError,
} from "../../../src/features/ocr/service";

const image = new Uint8Array([1, 2, 3]).buffer;

describe("Gemma 4 validation number OCR", () => {
  it("sends the original JPEG and accepts an exact six-digit response", async () => {
    const run = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "575831" } }],
    });

    await expect(
      recognizeValidateNumber({ run } as unknown as Ai, image, "image/jpeg"),
    ).resolves.toEqual({
      number: "575831",
      model: VALIDATE_NUMBER_MODEL,
    });

    expect(run).toHaveBeenCalledWith(
      VALIDATE_NUMBER_MODEL,
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image_url",
                image_url: { url: "data:image/jpeg;base64,AQID" },
              }),
            ]),
          }),
        ],
        chat_template_kwargs: {
          enable_thinking: false,
          clear_thinking: true,
        },
        skip_special_tokens: true,
        temperature: 0,
        max_completion_tokens: 16,
        stream: false,
      }),
    );
  });

  it("rejects prose or a non-six-digit answer", async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "The number is 575831." } }],
      }),
    } as unknown as Ai;

    await expect(
      recognizeValidateNumber(ai, image, "image/jpeg"),
    ).rejects.toBeInstanceOf(ValidateNumberOcrError);
  });

  it("maps Workers AI failures to a typed unavailable error", async () => {
    const ai = {
      run: vi.fn().mockRejectedValue(new Error("upstream timeout")),
    } as unknown as Ai;

    await expect(
      recognizeValidateNumber(ai, image, "image/jpeg"),
    ).rejects.toBeInstanceOf(ValidateNumberOcrUnavailableError);
  });
});
