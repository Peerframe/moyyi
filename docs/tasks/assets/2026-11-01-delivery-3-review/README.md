# Delivery-three review fixes: native evidence

Captured on 2026-11-01 using the packaged app and `native-d3.mjs` in a disposable directory.
The production main, preload, renderer and host bundles were retained. The worker used a fake
vault and synthetic providers, isolated settings/store, and blocked real network and credentials.
No prompt was sent. The normal window was 1120 × 800 px; the accepted native minimum was
780 × 560 px. Images are captured at 2× display scale.

- [Normal settings](settings-normal.png) and [narrow settings](settings-narrow.png) show the
  retained-legacy-key explanation and connection controls.
- Native alert accessibility captures cover both credential consequences at both sizes:
  [owned / normal](delete-owned-normal.ax.txt), [legacy / normal](delete-legacy-normal.ax.txt),
  [owned / narrow](delete-owned-narrow.ax.txt), [legacy / narrow](delete-legacy-narrow.ax.txt).
  Each displayed the exact connection name, credential consequence and Cancel/Delete buttons.
  Clicking Cancel returned to settings with both connections and fake-vault references retained.
- The native screenshot API returned a blank image for the macOS alert sheet. Those images were
  discarded; the AX captures establish text/control presence, not visual appearance of the sheet.
  Unit tests separately exercise confirmation, default/cancel IDs and stale-state rejection.
- [Receipt](native-receipt.json): zero synthetic requests/searches/credential reads/deletes;
  zero real network, credentials or native subprocess calls. The one synthetic key write is
  fixture setup. Both references, including `legacy-flash`, remained after cancellation.

The narrow run changed only the disposable main bundle's initial width/height, preserving the
production minimum. After quitting, original main/worker bytes were restored and all recorded
bundle hashes matched. The temporary app and isolated data were removed. Daily installation and
user data were not used.
