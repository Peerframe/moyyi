import { useState } from "react";
import type { DesktopArtifactPreview } from "../shared.ts";

/** Chromium receives only a checked local data URL, never a path or a model supplied URL. */
export function BoundedImage({
  image,
  name,
}: {
  image: NonNullable<DesktopArtifactPreview["image"]>;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p role="status">图片无法解码，未显示；原件仍保留。</p>
  ) : (
    <img
      className="bounded-image"
      src={image.dataUrl}
      width={image.width}
      height={image.height}
      alt={name}
      onError={() => setFailed(true)}
    />
  );
}
