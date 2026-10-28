import { describe, expect, it } from "vitest";
import { imagePreview } from "./image-preview.ts";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC8sAAAAASUVORK5CYII=",
  "base64",
);
describe("bounded local image inspection", () => {
  it("only emits inline PNG bytes after checking dimensions", () => {
    expect(imagePreview(png, "png")).toMatchObject({ width: 1, height: 1, mime: "image/png" });
    expect(imagePreview(png, "png").dataUrl).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
  });
  it("rejects remote/HTML payloads, excessive dimensions and bytes before decoding", () => {
    expect(() => imagePreview(Buffer.from('<svg onload="alert(1)">'), "png")).toThrow();
    const huge = Buffer.from(png);
    huge.writeUInt32BE(5000, 16);
    expect(() => imagePreview(huge, "png")).toThrow(/dimensions/);
    expect(() => imagePreview(Buffer.alloc(524289), "png")).toThrow(/512/);
    expect(() => imagePreview(png, "svg")).toThrow();
  });
  it("bounds JPEG segments and rejects absent or truncated frames", () => {
    expect(() => imagePreview(Buffer.from([255, 216, 255, 192, 0, 255]), "jpg")).toThrow();
    expect(() => imagePreview(Buffer.from([255, 216, 255, 218, 0, 2]), "jpg")).toThrow();
  });
});
