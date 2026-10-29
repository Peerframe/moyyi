export function object(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
export function string(value: unknown, max = 262_144): value is string {
  return typeof value === "string" && value.length <= max;
}
export function nullableString(value: unknown, max = 262_144): boolean {
  return value === null || string(value, max);
}
export function integer(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function nullableInteger(value: unknown): boolean {
  return value === null || integer(value);
}
export function choice(value: unknown, choices: string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

export const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const nullableHash = (value: unknown) => value === null || hash(value);
function encodedImageSize(v: string): boolean {
  const encoded = v.slice(v.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return encoded.length % 4 === 0 && (encoded.length / 4) * 3 - padding <= 524288;
}
function imageView(v: unknown): boolean {
  return (
    object(v, ["mime", "width", "height", "dataUrl"]) &&
    Object.keys(v).length === 4 &&
    choice(v.mime, ["image/png", "image/jpeg"]) &&
    integer(v.width) &&
    Number(v.width) > 0 &&
    Number(v.width) <= 4096 &&
    integer(v.height) &&
    Number(v.height) > 0 &&
    Number(v.height) <= 4096 &&
    Number(v.width) * Number(v.height) <= 8388608 &&
    string(v.dataUrl, 700000) &&
    new RegExp(`^data:${v.mime};base64,[A-Za-z0-9+/]+={0,2}$`).test(v.dataUrl) &&
    encodedImageSize(v.dataUrl)
  );
}

export function previewView(preview: unknown): boolean {
  if (
    preview !== null &&
    !(
      object(preview, [
        "effectId",
        "path",
        "sha256",
        "text",
        "sourceBytes",
        "truncated",
        "image",
      ]) &&
      (preview.image === undefined || imageView(preview.image)) &&
      string(preview.effectId, 128) &&
      string(preview.path, 4096) &&
      hash(preview.sha256) &&
      string(preview.text, 65_536) &&
      integer(preview.sourceBytes) &&
      Number(preview.sourceBytes) <= 10_485_760 &&
      typeof preview.truncated === "boolean"
    )
  )
    return false;
  return true;
}
