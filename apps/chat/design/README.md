# moyyi Chat design files

`tokens.json` and `bundle.css` are copied byte for byte from the owner's moyyi Chat design system
(claude.ai artifact, version 20, 2026-11-04: rail with 在做, 插件 and 设置; settings and plugin pages). Do not edit them here: change the design system,
then copy both files again. Biome skips them so formatting cannot drift from the source.

- `tokens.ts` turns `tokens.json` into `tokens.css` at build time: shared scales on `.mc-dark` and
  `.mc-light`, colours per theme. This is the same shape the design canvas uses, so components
  render the same here as on the boards.
- `bundle.css` holds every `mc-` component class.
- Page layout and the styles the boards write inline live in `apps/chat/app.css` as `ch-` classes,
  using only these tokens. `tests/chat-design.test.ts` checks that every variable either
  stylesheet uses is defined in both themes.
- `../assets/character.png` is a 320 px copy of `design/brand/2026-10-28-brandkit/character.png`,
  used for the four sticker moments and empty states.
