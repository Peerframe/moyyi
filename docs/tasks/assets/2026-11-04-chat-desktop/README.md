# Native Chat screenshots

These screenshots show the real local model settings, without credentials or private transcripts.

- `normal.jpg`: final installed `b2ef510` app, 1120 × 800 logical pixels (2240 × 1600 Retina).
- `narrow.jpg`: isolated `bffb6fc` package copy, 780 × 560 logical pixels (1560 × 1120 Retina).
  Only the initial BrowserWindow width/height were changed in the copy. Native minimums,
  sandbox, renderer and runtime stayed unchanged. This reuses the method documented in
  `2026-10-29-desktop-modules-delivery.md` because CUA cannot drag the native exterior border.

The later `b2ef510` code change adds background, border and inline padding only to the native
notice container. The unchanged narrow settings layout reuses the earlier screenshot. The final
notice fix was separately checked at 780 × 560 in a fresh copy of the final package: the banner
stays legible over scrolling table content. That screenshot contains real history and is retained
locally, not committed. The temporary main file was restored and every app asset matched the
installed final app before the verification copy was removed. The final daily app was reopened
from its installed path and left running. No task was sent and no credential was changed.
