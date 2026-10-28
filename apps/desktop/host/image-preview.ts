/** Inspect dimensions before Chromium decodes imported pixels. No metadata or remote resources. */
export function imagePreview(
  bytes: Uint8Array,
  format: string,
): {
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  dataUrl: string;
} {
  const data = Buffer.from(bytes);
  if (data.length > 524_288)
    throw Error("Image preview is limited to 512 KiB; the original is retained");
  let width = 0,
    height = 0;
  let mime: "image/png" | "image/jpeg";
  if (format === "png") {
    mime = "image/png";
    if (
      data.length < 33 ||
      !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      data.toString("ascii", 12, 16) !== "IHDR" ||
      data.readUInt32BE(8) !== 13
    )
      throw Error("Invalid PNG");
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
  } else if (format === "jpg" || format === "jpeg") {
    mime = "image/jpeg";
    if (data[0] !== 0xff || data[1] !== 0xd8) throw Error("Invalid JPEG");
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset] !== 0xff) throw Error("Invalid JPEG segment");
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const size = data.readUInt16BE(offset);
      if (size < 2 || offset + size > data.length) throw Error("Invalid JPEG segment size");
      if (marker !== undefined && [0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) throw Error("Invalid JPEG frame");
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  } else throw Error("Only PNG and JPEG can be previewed");
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8_388_608)
    throw Error("Image dimensions exceed preview limits");
  return { mime, width, height, dataUrl: `data:${mime};base64,${data.toString("base64")}` };
}
