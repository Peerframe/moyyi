# Native settings on macOS arm64

The v61 settings pages were exercised on 2026-11-19 in an external copy of the packaged
`a9e32c1` app. Candidate ZIP SHA-256
`b2b79b5af06394b8a6914e09babb95ae2ffa55c8e285cf23408485e3c3ded3fd`.

| Window capture | State |
|---|---|
| [General, 1120 × 800](general-1120.png) | Light appearance and 15 px text, with dark system appearance |
| [Help, 780 × 560](help-780.png) | First help topic expanded at the native minimum, with dark appearance, light system appearance and 17 px text |
| [Model validation, 1120 × 800](model-error-1120.png) | Kimi China with high effort, empty password input and an inline validation error |

## Reproduce

Use a disposable copy of the app, an empty home directory and a separate Electron user-data
directory. Start the copy's executable directly. Open **打开模型设置** on the unconfigured
start screen, then use the settings list. The native run checked the following paths.

- Open all nine settings pages. Search for an absent term and use **清除搜索** to recover the list.
- Choose each font size and both explicit themes. With **跟随系统** selected, change the system
  appearance in both directions. Check the rail with the app and system set to opposite themes.
- Inspect the disabled personal instruction and memory controls. Without a workspace,
  check that permissions and session-specific data actions are disabled. Open and close the
  backup dialog without creating or restoring a backup.
- Open and close a help topic and the usage guide. Expand the packaged third-party notices in About.
- Choose Kimi China, wait for configuration to complete, and select high effort. Enter a synthetic
  value with an internal space. Submitting cleared the password input and displayed the error
  and retry instruction inside the connection card.
- Quit the application, relaunch the same copy and revisit General and Model. Dark appearance,
  17 px text, Kimi China and high effort were retained. The isolated host settings file also
  recorded `preset: kimi-cn` and `kimiReasoningEffort: high`.

The copy passed signature verification before instrumentation. A temporary main entry imported
the packaged main module and drove visible controls with Electron mouse events and text input.
The main, bridge, preload, renderer, worker and host code and both Chat stylesheets matched
the package byte for byte. WindowServer captured the windows, including native traffic lights.
The PNGs are scaled to their logical window dimensions. The test used an empty session store,
no real credential and no model request.
