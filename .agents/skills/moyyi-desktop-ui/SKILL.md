---
name: moyyi-desktop-ui
description: Build or review moyyi desktop UI using the design rules, existing components and truthful states. Use for renderer, dialog, panel or copy changes in apps/desktop; not for host-only logic or a visual redesign without a brief.
---

# moyyi-desktop-ui

## Inputs

The user action and expected result, the affected screen, and the window sizes to support.
Read [docs/design.md](../../../docs/design.md) and [apps/desktop/AGENTS.md](../../../apps/desktop/AGENTS.md).

## Steps

1. **Reuse first.** Find an existing component in the design rules' component list. Add a new one
   only when no existing component fits, and add it to the list.
2. **Tokens only.** Colors, spacing, radii and type sizes come from the CSS variables in
   `apps/desktop/renderer/styles.css`. Add a variable instead of a literal value.
3. **All states.** Design loading, empty, error, waiting for approval, cancelled and unknown
   outcome, not only success. Success appears only with a recorded receipt or effect.
4. **Feedback placement.** An error about a field or card stays next to it; a decision the user
   must make is a dialog or approval card; nothing important appears only as a transient notice.
5. **Copy.** Chinese, short and direct; say what happened and what the user can do. Keep
   technical names (file names, commands, model IDs) unchanged.
6. **Security.** Text from models, documents and web pages is rendered as escaped text. No remote
   images, links that navigate the app, or HTML injection.
7. **Accessibility.** Every control is reachable by keyboard with a visible focus ring; respect
   reduced motion.
8. **Verify.** Run the renderer tests, build the app, and capture screenshots at normal width and
   at the minimum width (560 px). Attach them to the PR.

## Review questions

- Does the screen ever claim more than the runtime recorded?
- Is there a state the user can reach that has no design (for example, cancelled during approval)?
- Would a new user understand the next step from the screen alone?
