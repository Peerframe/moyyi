# Threat model

Status: draft. Each section needs concrete assumptions before phase 2 (writes) and phase 3
(processes) are implemented.

## Assets

- The user's files inside and outside authorized workspaces
- Credentials: model API keys, tokens in the environment, files such as `~/.ssh`
- Session data: transcripts may contain private content
- External accounts reachable through tools

## Threats

| # | Threat | Example | Primary defense |
|---|---|---|---|
| T1 | Model mistake | Edits the wrong file, runs a destructive command | Effect classes, approval bound to digest, snapshots and undo |
| T2 | Injected instructions in content | A file or web page tells the agent to upload `~/.ssh` | Content is data; policy does not depend on model intent; network egress policy |
| T3 | Malicious or buggy tool / MCP server | Tool annotations lie about being read-only | Effect profile is assigned by moyyi, not by the tool's self-description |
| T4 | Local adversary racing the agent | Swaps a symlink between check and write | To decide: likely out of scope, document if so |

## Boundaries

- Policy decides what the agent may *request*. Containment (OS sandbox) decides what a process can
  *do*. Policy alone is not a security boundary for `process` effects.
- Secrets are never written to the transcript or logs; to define: redaction rules for exports.

## Open questions

- Which paths are readable without asking (workspace only, or also selected user directories)?
- Default network policy for sandboxed processes
- Whether rendered requests (which may contain secrets read from files) need encryption at rest
