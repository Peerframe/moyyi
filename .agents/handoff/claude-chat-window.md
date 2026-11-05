# Handoff: Chat window and rail after the 2026-11-05 owner review
- Brief: none. Owner review on 2026-11-05 of the installed Chat app (PR #60):
  - remove the shark girl;
  - make the rail translucent;
  - drop the separate title-bar strip (traffic lights go in the rail, as in Telegram for macOS);
  - the 等我的 folder is wrong ("这个等我的不好，你需要思考我们的界面需要什么");
  - drop the AI folder, because the model is chosen in 设置;
  - drop 成果;
  - put working folders inside 项目, because the rail holds only functional places;
  - the rail is "全部 / 自动化 / 更多", with 插件 and 设置 at the bottom;
  - keep 更多 as a hidden slot (端口) until its contents are decided.
- Canvas: https://claude.ai/artifact/Cfhj4xyxqATonqeGXDaVS2, version 55.
- Design system: https://claude.ai/artifact/3yRcxDo7PaDuuQcSy6D8pP, version 22.
- Branch: codex/chat-desktop-integration, on top of Codex's b2ef510/ab09588. Work in this worktree.
- Last agent: Claude, 2026-11-05.

## Decisions taken
- **Rail.** The rail holds places only, from top to bottom:
  - 全部: every chat, by time.
  - 项目: the working folders. Opening one lists that project's chats, archived ones included, under a ← 项目 back button.
  - 自动化: jobs that start on their own.
  - 更多: a reserved slot. `MORE` in `Rail.tsx` is empty, so the button is not drawn. Once items are added, it opens a menu beside the rail.
  - 插件 and 设置 sit at the bottom.
- **Removed places.**
  - No AI folder.
  - No 成果. Results stay in their chat.
  - No 等我的 or 在做. These are states of a chat: the badge, the 等你决定： prefix, and the working dot.
- **自动化.**
  - Each job belongs to one chat and shows what it does, when it runs, its recent runs, 暂停 / 继续, 现在跑一次 and 删掉.
  - Jobs moved out of 设置 › 后台 (formerly 后台和定时).
  - In the desktop app the list is empty, with an honest note that the local version cannot run schedules.
- **Desktop.** `chat-world.ts` gives every session `project = workspaceRoot` and builds one project per working folder. The artifact controls added for 成果 are removed again.
- **Window (macOS).**
  - `titleBarStyle: hidden`.
  - Traffic lights at {20, 27}, inside the rail's 34px top strip.
  - `vibrancy: sidebar` with a transparent page ground.
  - Glass rail.
  - Drag regions: the rail, list head, chat top and page titles.
- **Character.** The shark girl, stickers and character.png are removed until the art is finished.

## Done
- App changes:
  - port: `FolderId` is all | project; adds `projects` and `automations`; Result* types removed;
  - mock: `PROJECTS`, `automationPages()` and the automate actions;
  - Rail with a hidden 更多 slot;
  - ChatList: project list and drill-down;
  - Pages: the 自动化 kind;
  - App routing;
  - icons;
  - desktop chat-world and ChatApp.
- Tests: rail order, the hidden 更多 slot, projects, automations, the 后台 page, and desktop projects.
- 更多 menu, checked in headless Chrome over CDP while it was visible (`scratchpad/more.mjs`):
  - opens beside the rail, inside the viewport;
  - focuses its first item;
  - Esc returns focus to 更多;
  - a click outside closes it;
  - picking an item opens it.
  - Fix found by this check: the rail's backdrop-filter made it the menu's containing block and clipped the menu. The menu is now the rail's sibling. A react-dom portal is not allowed in app:chat.
- Canvas v54 and v55:
  - every rail is 全部 / 项目 / 自动化 | 插件 / 设置;
  - the 项目 badge matches the row rule (1);
  - S33 is now 项目 (project list, drill-down, empty);
  - new S34 自动化;
  - S26 is 后台 without 定时的事;
  - S6 shows an empty 自动化 instead of an empty 成果;
  - S8's list title, S13's caption and the notes are updated.
- Design system v22:
  - README rules: places, 项目 and 自动化, 后台, results stay in their chat, rail icons;
  - FolderRail README and preview;
  - ResultMessage README;
  - `rail-label` sample;
  - tokens and README copied to apps/chat/design.
- Docs: the desktop.md use paragraph and the system-overview row.

## Next
- Owner decides what goes in 更多 (asked on 2026-11-05: 暂时没想好).
- Full `npm run check` on an idle machine (see Collected problems).
- Native:
  - package with Node 26 (`/opt/homebrew/bin`);
  - run `verify:desktop`;
  - back up `~/.moyyi` and the old app;
  - quit the installed app gracefully and replace it;
  - launch it;
  - check the window at normal and narrow widths, then tune `TRAFFIC_LIGHTS`.
  - Never run a second instance on the owner's store.
- Canvas S24 comment: settings should fit an agent better. Not started.

## Collected problems
- The mock's 全部 still holds AI private chats (核查, 研读, 写作, 翻译). With no AI folder, it is unclear whether those chats should stay as contacts. Raise this with the owner.
- 对账 wording remains on S5, S13, S21 and S22, in the DS result keys, and in the chat's result key and `/对账`. It is the claim-check action, not a removed place; whether to keep or rename it is a separate decision.
- `npm run check` on 2026-11-05 ran while the load average was about 11:
  - 18 tests in untouched store/runtime/desktop-host files timed out; one assertion was the react-dom import, which is now fixed.
  - Rerun alone, 19 of those 20 files pass.
  - `src/runtime/documents.test.ts` ("rejects unsupported, corrupt, empty and encrypted containers distinctly") still takes about 5005 ms against its 5000 ms limit.
  - `src/runtime` is unchanged on this branch. Recheck it on an idle machine.

## Commands run
- `npx tsc --noEmit -p .`: clean.
- `npx biome check apps/chat`: clean.
- `npm run check` (Node 26): 3142 passed, 19 failed. One failure was the boundary violation, now fixed. The other 18 were load timeouts; see Collected problems.
- After the fixes:
  - `npx tsc --noEmit -p .`: clean.
  - `npx biome check apps tests docs`: clean.
  - `npx vitest run tests/boundaries.test.ts apps/chat apps/desktop tests/chat-design.test.ts tests/desktop-feature-extension.test.ts`: 320 passed. This set includes the desktop host tests that had timed out.
  - `npm run chat:build` and `npm run desktop:build`: passed.
- Headless Chrome screenshots of the app (全部, 项目, drill-down, 自动化, 设置) and of boards S6, S26, S33 and S34.

## Paid usage ledger
- None.
