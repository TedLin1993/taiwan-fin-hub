export class ValidateNumberImageTooLargeError extends Error {}
export class ValidateNumberEmptyImageError extends Error {}
export class ValidateNumberOcrError extends Error {}
export class ValidateNumberOcrUnavailableError extends Error {}

export const VALIDATE_NUMBER_MODEL = "@cf/google/gemma-4-26b-a4b-it";

export async function recognizeValidateNumber(
  ai: Ai,
  imageBytes: ArrayBuffer,
  contentType: string | undefined,
) {
  if (imageBytes.byteLength === 0) throw new ValidateNumberEmptyImageError();
  if (imageBytes.byteLength > 256_000)
    throw new ValidateNumberImageTooLargeError();
  if (!contentType || !["image/jpeg", "image/jpg"].includes(contentType))
    throw new ValidateNumberOcrError();

  let response: Record<string, unknown>;
  try {
    const model: string = VALIDATE_NUMBER_MODEL;
    response = await ai.run(model, {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read the six digits in this CAPTCHA. Return exactly six digits and nothing else.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${contentType};base64,${arrayBufferToBase64(imageBytes)}`,
              },
            },
          ],
        },
      ],
      chat_template_kwargs: {
        enable_thinking: false,
        clear_thinking: true,
      },
      skip_special_tokens: true,
      temperature: 0,
      max_completion_tokens: 16,
      stream: false,
    });
  } catch (error) {
    throw new ValidateNumberOcrUnavailableError(
      error instanceof Error ? error.message : String(error),
    );
  }

  const number = readMessageContent(response).trim();
  if (!/^\d{6}$/.test(number)) throw new ValidateNumberOcrError();
  return {
    number,
    model: VALIDATE_NUMBER_MODEL,
  };
}

function readMessageContent(response: Record<string, unknown>) {
  const choices = response.choices;
  if (!Array.isArray(choices)) return "";
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return "";
  const content = choice.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}

function arrayBufferToBase64(bytes: ArrayBuffer) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 1)
    binary += String.fromCharCode(view[index] ?? 0);
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
