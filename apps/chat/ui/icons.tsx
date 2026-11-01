// Stroke icons on a 16px grid, copied path for path from the moyyi Chat canvas boards.
// Painted in the current text colour; decorative unless a label is given.
import type { ReactNode } from "react";

interface IconProps {
  readonly size?: number;
  readonly label?: string;
}

function stroke(paths: ReactNode, width = 1.4, viewBox = "0 0 16 16") {
  return function Icon({ size = 16, label }: IconProps) {
    const [, , w = 16, h = 16] = viewBox.split(" ").map(Number);
    const shape = {
      width: size,
      height: (size * h) / w,
      viewBox,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: width,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    } as const;
    if (!label)
      return (
        <svg {...shape} aria-hidden="true">
          {paths}
        </svg>
      );
    return (
      <svg {...shape} role="img" aria-label={label}>
        <title>{label}</title>
        {paths}
      </svg>
    );
  };
}

export const Icon = {
  all: stroke(<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />),
  ai: stroke(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.2v1.6M8 9.2v1.6M5.2 8h1.6M9.2 8h1.6" />
    </>,
  ),
  project: stroke(<rect x="2.5" y="2.5" width="11" height="11" rx="3" />),
  clock: stroke(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>,
  ),
  ledger: stroke(<path d="M1.5 8.5l2.5 2.5 5-6M7.5 10.5l.5.5 6-6.5" />),
  bookmark: stroke(<path d="M4.5 2.5h7v11l-3.5-2.5-3.5 2.5z" />, 1.6),
  pin: stroke(<path d="M6 2.5h4l-.5 4 2.5 2.5h-8l2.5-2.5zM8 9v4.5" />, 1.5),
  muted: stroke(<path d="M3 6h2.5L9 3v10L5.5 10H3zM11.5 6l3 4M14.5 6l-3 4" />, 1.5),
  recorded: stroke(<path d="M2 6.5l3 3 6-7" />, 1.5, "0 0 16 12"),
  taken: stroke(<path d="M1.5 6.5l3 3 6-7M8 9.5l1 0.5 6-7.5" />, 1.5, "0 0 18 12"),
  sending: stroke(
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>,
    1.6,
  ),
  list: stroke(<path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01" />),
  done: stroke(<path d="M3 8.5l3 3 7-7.5" />, 1.8),
  stopped: stroke(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />, 1.6),
  todo: stroke(<circle cx="8" cy="8" r="4.5" />),
  search: stroke(
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>,
  ),
  info: stroke(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3.5M8 5h.01" />
    </>,
  ),
  attach: stroke(
    <path d="M10.5 4.5l-5 5a1.5 1.5 0 0 0 2 2l5.5-5.5a3 3 0 0 0-4-4L3.5 7.5a4.5 4.5 0 0 0 6.5 6.5l3-3" />,
  ),
  emoji: stroke(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.8 9.5c1.2 1.3 3.2 1.3 4.4 0M6 6.5h.01M10 6.5h.01" />
    </>,
  ),
  close: stroke(<path d="M4 4l8 8M12 4l-8 8" />, 1.5),
  back: stroke(<path d="M10 3.5L5.5 8l4.5 4.5" />, 1.6),
  mic: stroke(
    <>
      <rect x="5.5" y="2" width="5" height="8" rx="2.5" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" />
    </>,
    1.5,
  ),
  attention: stroke(<path d="M8 3v6M8 12h.01" />, 1.6),
  down: stroke(<path d="M8 3v10M4 9l4 4 4-4" />, 1.6),
  file: stroke(
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
    </>,
  ),
  image: stroke(<path d="M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10 6h.01" />),
  screenshot: stroke(<path d="M2.5 5.5v-2h2M11.5 3.5h2v2M13.5 10.5v2h-2M4.5 12.5h-2v-2" />),
  folder: stroke(<path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" />),
  link: stroke(
    <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L8.5 4M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.5-.5" />,
  ),
  command: stroke(
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M5 6.5l2 1.5-2 1.5M8.5 10h2.5" />
    </>,
  ),
};

export function NowDot({ size = 14 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="4" fill="currentColor" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 2l7 4-7 4z" fill="currentColor" />
    </svg>
  );
}
