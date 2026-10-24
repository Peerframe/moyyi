# OpenBot provenance

moyyi is a new project. OpenBot's code is not copied wholesale, renamed or used as a fallback.
This file records everything that is taken from OpenBot so the origin stays traceable.

## Rules

- Port failure scenarios and the knowledge in their tests, rewritten against moyyi's contracts.
- Small functions without business dependencies may be copied. Record each one below with its
  source path and revision.
- Not ported: Server authority, Bot/team/channel models, Temporal, old protocols, old database
  migrations.

## Failure scenarios to port

Each becomes a deterministic test using the scripted model and fault injection:

- [ ] Cancellation racing a tool start
- [ ] Permission revoked during a run
- [ ] Output and input size limits exceeded
- [ ] Invalid tool arguments
- [ ] Symlinks pointing outside the workspace
- [ ] Overwrite conflicts (file changed after preview or approval)
- [ ] Outcome unknown after interruption

## Copied code

| moyyi path | OpenBot source | Revision | Notes |
|---|---|---|---|
| — | — | — | nothing copied yet |
