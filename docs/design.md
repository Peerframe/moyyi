# Desktop design rules

How the moyyi desktop app should look, read and behave. The
[moyyi-desktop-ui](../.agents/skills/moyyi-desktop-ui/SKILL.md) skill applies these rules to a
change; [apps/desktop/AGENTS.md](../apps/desktop/AGENTS.md) owns the security rules.

## Brand

- **Name**: moyyi; Chinese name 墨一.
- **Character**: a chibi shark girl with blue hair, a light blue cardigan and a small shark tail.
  Calm and clever, with a small playful streak. The character appears in onboarding, empty states
  and the About screen, never inside working content such as messages, approvals or results.
- **Logo**: a softly rounded lowercase `m` ending in a restrained shark tail. Keep it simple: no
  full shark, face, gills or speech bubble.
- **Source assets**: [design/brand/2026-10-28-brandkit](../design/brand/2026-10-28-brandkit/README.md)
  is the owner's preferred baseline (2026-10-28). It is a raster concept; vector masters and
  icon-size exports are still to be produced. Other directions in `design/brand/` are rejected
  history.

### Brand palette

| Name | Value | Use |
|---|---|---|
| Ink navy | `#263C67` | Primary actions, selected navigation, logo |
| Periwinkle | `#A7C1E8` | Accents, focus halos, illustrations |
| Pale mist | `#DCE7F5` | Selected and highlighted backgrounds |
| Offwhite | `#F6F8FC` | Brand surfaces such as onboarding |

## Tokens

All colors, spacing, radii and type sizes come from CSS variables in
`apps/desktop/renderer/styles.css`. A component never uses a literal color. The current neutral
tokens (`--page`, `--sidebar`, `--fill`, `--fill-hover`, `--selected`, `--text`, `--muted`,
`--line`, `--surface`) and status tokens (`--focus`, `--danger`, `--attention`) stay. Add brand
tokens when the next UI delivery touches primary actions:

| Token | Value | Replaces |
|---|---|---|
| `--brand` | `#263C67` | Primary button fill and selected-item text |
| `--brand-soft` | `#DCE7F5` | Selected background where a neutral `--selected` is too weak |
| `--brand-accent` | `#A7C1E8` | Decorative accents only; never text on white (contrast too low) |

Text and controls meet WCAG AA contrast (4.5:1 for body text). Dark mode is not supported yet; when
it is added, it is added for every token at once, not per component.

Typography uses the system font stack (`-apple-system`, `PingFang SC`) at a 14 px base. Use
weight and size for hierarchy, not color alone.

## Components

Reuse before adding. New components are added to this list in the same change.

| Component | Purpose | Origin |
|---|---|---|
| `ApprovalCard` | Ask the user to approve one exact action, with summary and preview | Adapted from OpenBot |
| `ArtifactCard` | A produced file or report, backed by a recorded receipt | Adapted from OpenBot |
| `EffectsPanel` | History of effects with status, undo and recovery | Adapted from OpenBot |
| `RichMessage` | Safe Markdown subset for model output; raw HTML, links and remote images inert | Adapted from OpenBot |
| `SessionSidebar` | Sessions, search, pin and grouping | Adapted from OpenBot |
| `MessageList` | Conversation transcript | moyyi |
| `ArtifactsPanel` | All results of a session | moyyi |
| `SourcesPanel` | Recorded web sources with URL, status, time and truncation | moyyi |
| `MaterialsPanel` | Imported materials and current selection | moyyi |
| `HistoryPanel` | Paged complete history | moyyi |
| `BoundedImage` | Local PNG/JPEG preview within size limits | moyyi |
| `SettingsDialog` | Model connection and preferences | moyyi |
| `PermissionsDialog`, `WebAccessDialog` | Grant workspace or site access for the current session | moyyi |
| `MaintenanceDialog` | Backup, restore and software rollback | moyyi |
| `UsageGuide` | First-use guidance | moyyi |

## States

Every screen and card defines each state it can reach:

| State | Rule |
|---|---|
| Loading | Show progress in place; keep the previous content visible when refreshing |
| Empty | Say what belongs here and the one action that fills it |
| Waiting for approval | The approval card is the focus; other actions that would conflict are disabled with a reason |
| Running | Show what is happening now and offer cancel |
| Cancelled | Say what was stopped and what had already happened |
| Failed | Say what failed and what the user can do next |
| Unknown outcome | Say the result could not be confirmed and how to check it; never show it as success or failure |
| Success | Only with a recorded receipt or effect; link to the result |

## Feedback placement

- A problem with one field, card or file is shown next to it.
- A decision the user must make is an approval card or a dialog, never a transient notice.
- Transient notices are only for confirmations the user can also see elsewhere (for example,
  "saved", with the file visible in results).
- Errors are never shown only in logs.

## Copy

- Interface language is Chinese. Keep technical names unchanged: file names, commands, model IDs,
  URLs.
- Short and direct. Say what happened and what the user can do: "无法读取 report.md：文件已被
  移动。重新选择文件后再试。" rather than a generic error.
- The app speaks plainly as a tool. Do not make it sound like a person, and do not use exclamation
  marks or emoji in working screens.
- Never claim more than the runtime recorded: "已保存" only after a receipt, "可能已执行" for an
  unknown outcome.

## Layout, accessibility and motion

- The accepted native window minimum is 780 px (M6); its narrow capture is 780 × 560 px.
  The CSS declares a 560 px body minimum and switches below 800 px. A 560 px renderer capture is
  a separate diagnostic outside the native window range, not native acceptance.
- Every control is reachable by keyboard and shows the `--focus` outline.
- Respect `prefers-reduced-motion`; motion is short and never required to understand state.
- Text from models, documents and web pages is always escaped text.

## Acceptance for UI changes

A PR that changes visible UI includes native screenshots at 1120 × 800 and 780 × 560 px, covering the
states it changed. Visual changes without a brief stay small and use existing components.
