# Local daemon

Run one moyyi runtime in the background and use it from several terminals. The daemon owns the
private data directory, its grants and its runs; `--connect` clients send commands and show
events. Decision and rationale: [ADR 0048](decisions/0048-local-daemon.md). The desktop app does
not use the daemon yet.

## Start and connect

Start the daemon in the workspace it will serve, with the same host and grant options as the
ordinary CLI ([cli.md](cli.md)):

```sh
moyyi --daemon --host ~/moyyi-host.mjs -C ~/project --allow-write
```

It prints its fixed grants and the socket path, then serves until Ctrl-C (SIGINT) or SIGTERM.
In another terminal:

```sh
moyyi --connect                      # interactive session in the daemon's workspace
moyyi --connect "Summarize README.md" # one-shot prompt
moyyi --connect --session SESSION_ID -i
```

Use `--data DIR` on both sides when the data directory is not the default `~/.moyyi/data`.
Session commands (`/new`, `/resume`, `/sessions`, `/results`, `/compact`, `/cancel`, `/approve`,
`/deny`) work as in the local CLI.

## What stays fixed

- **Grants and host.** `--connect` rejects `--demo`, `--host`, `-C`, `--allow-*`, `--web-*`,
  `--shell-toolchain`, `--approve-reads`, `--max-requests`, `--timeout`, `--auto-compact`,
  `--long` and development options. Restart the
  daemon to change them. The client prints the daemon's grant lines on connect.
- **Workspace.** The daemon creates sessions only in its own workspace. `/resume` loads any
  recorded session of the store, as in the local CLI, under the daemon's grants.
- **Input.** Remote prompts are text only, at most 64 parts of 256 KiB, and still subject to the
  runtime's 64 KiB input limit.
- **Exclusivity.** While the daemon runs, a local CLI or desktop app using the same data directory
  cannot open the store.

## Several clients

- Each client sees the events of the session it created or loaded. Another client that resumes
  the same session sees later entries, effects and approval requests of a run already in progress.
- Any connected client viewing a run may answer its approval with the displayed effect ID; the
  approval still has to match the displayed digest. `/always` rules belong to the session and
  last until it is loaded again or the daemon stops.
- Exiting a client, or losing its connection, cancels the runs that client started. Stopping the
  daemon cancels all client runs and removes the socket and token.

## Security

- The socket `daemon.sock` and the token `daemon-token` are created in the data directory, which
  must be owned by you with mode 0700. The socket is 0600; the token is a fresh 256-bit value
  written with mode 0600 on each start. Clients refuse a directory, socket or token that is not
  owned by the current user.
- The daemon never listens on a network interface. Anyone who can read your token file can already
  read your stored sessions; the daemon does not protect against root or other processes of your
  own account.
- Every client frame is validated before the runtime sees it, and frames are size-bounded.

## Limits

| Item | Limit |
|---|---|
| Clients | 8 authenticated or pending |
| Authentication | First frame within 5 s and 4 KiB |
| Client frame | 1 MiB |
| Server frame | 16 MiB; a larger event disconnects that client with a reload message |
| Unanswered frames per client | 16 |
| Unsent output per client | 64 MiB, then the client is disconnected |
| Socket path | 103 bytes; choose a shorter `--data` if it is longer |

## Troubleshooting

- `Could not connect to a daemon for this data directory`: start one with `--daemon`, or pass the
  same `--data` as the daemon.
- `Initialization failed` when starting the daemon: another process holds the store (a running
  daemon, CLI or desktop app), or the host or workspace is invalid.
- `The daemon could not start`: the data directory is not private, its path is too long for a
  socket, or an unexpected file occupies `daemon.sock` or `daemon-token`.
