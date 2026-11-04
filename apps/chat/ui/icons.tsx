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
  running: stroke(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.8 5.6l3.4 2.4-3.4 2.4z" />
    </>,
  ),
  plugins: stroke(
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" />
      <path d="M11.25 9v4.5M9 11.25h4.5" />
    </>,
  ),
  settings: stroke(
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M6.9 1.8h2.2l.4 1.7 1.3.6 1.5-.9 1.6 1.6-.9 1.5.6 1.3 1.7.4v2.2l-1.7.4-.6 1.3.9 1.5-1.6 1.6-1.5-.9-1.3.6-.4 1.7H6.9l-.4-1.7-1.3-.6-1.5.9-1.6-1.6.9-1.5-.6-1.3-1.7-.4V6.9l1.7-.4.6-1.3-.9-1.5 1.6-1.6 1.5.9 1.3-.6z" />
    </>,
    1.3,
  ),
  key: stroke(
    <>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M7.7 8.3L13.5 2.5M11 5l1.8 1.8M9.5 6.5l1.5 1.5" />
    </>,
  ),
  me: stroke(
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5a5 5 0 0 1 10 0" />
    </>,
  ),
  shield: stroke(
    <>
      <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z" />
      <path d="M5.8 8l1.6 1.6 2.8-3" />
    </>,
  ),
  timer: stroke(
    <>
      <circle cx="8" cy="9" r="5" />
      <path d="M8 6.5V9l1.8 1.2M6 1.8h4" />
    </>,
  ),
  gauge: stroke(<path d="M2.5 11.5a5.5 5.5 0 0 1 11 0M8 11.5l2.5-3" />),
  db: stroke(
    <>
      <ellipse cx="8" cy="4" rx="5" ry="1.8" />
      <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" />
    </>,
  ),
  sliders: stroke(
    <>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </>,
  ),
  term: stroke(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M4.5 6l2 2-2 2M8 10.5h3.5" />
    </>,
  ),
  globe: stroke(
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.7 1.6 2.5 3.4 2.5 5.5S9.7 11.9 8 13.5C6.3 11.9 5.5 10.1 5.5 8S6.3 4.1 8 2.5z" />
    </>,
  ),
  doc: stroke(
    <>
      <path d="M4 1.8h5l3 3v9.4H4z" />
      <path d="M9 1.8v3h3M6 8.5h4M6 11h4" />
    </>,
  ),
  skill: stroke(
    <>
      <path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z" />
      <path d="M3 11.5a2 2 0 0 1 2-2h7.5" />
    </>,
  ),
  lock: stroke(
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>,
  ),
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
  send: stroke(<path d="M8 13V3.5M3.5 8L8 3.5 12.5 8" />, 1.8),
  compose: stroke(<path d="M7.5 3H3v10h10V8.5M6.5 9.5l.5-2.5 5-5 2 2-5 5z" />, 1.4),
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
  /** The rounded folder settings use for a granted folder. */
  grant: stroke(
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  ),
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
