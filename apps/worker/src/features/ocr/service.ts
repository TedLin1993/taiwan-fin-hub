import { readValidateNumberFromImage } from "../../connectors/validate-number-ocr";

export class ValidateNumberImageTooLargeError extends Error {}
export class ValidateNumberEmptyImageError extends Error {}
export class ValidateNumberOcrError extends Error {}

export async function recognizeValidateNumber(
  imageBytes: ArrayBuffer,
  contentType: string | undefined,
) {
  if (imageBytes.byteLength === 0) throw new ValidateNumberEmptyImageError();
  if (imageBytes.byteLength > 256_000)
    throw new ValidateNumberImageTooLargeError();
  const result = await readValidateNumberFromImage(imageBytes, { contentType });
  if (!/^\d{6}$/.test(result.text)) throw new ValidateNumberOcrError();
  return {
    number: result.text,
    confidence: result.confidence,
    digits: result.digits,
    image: { width: result.width, height: result.height },
  };
}
