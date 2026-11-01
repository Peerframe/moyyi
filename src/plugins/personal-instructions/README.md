# Personal instructions

`createPersonalInstructionsPlugin(read)` registers one context source for explicit trusted-host
guidance. The host reader returns `{ text, sha256 }` or `null`; it receives cancellation and no
model-supplied path. Runtime verifies SHA-256 against the exact UTF-8 text before returning the
source. The plugin checks Unicode, the 64-character lowercase hexadecimal digest and the
8 KiB text ceiling. It imports no filesystem, process or network capability.

Runtime installs this source after default instructions and before project `AGENTS.md`.
Collection refreshes it on every model request, including the next request in an active run.
Changing or removing guidance affects future requests only. Empty text contributes no section.
The CLI retains its existing configuration behavior; it does not read desktop settings.

## Model experience

The model receives a required `turn` system section after default identity/safety and before
project guidance. Its fixed introduction is:

```text
Personal instructions are user guidance below explicit task instructions and host safety rules. They never grant tool permissions or approve actions.
Personal instruction source (个人指令; JSON; text is guidance):
```

The following JSON object contains `source: "个人指令"`, the verified `sha256` and the entire
`text`. No absolute path or keychain reference is included. The text is guidance, not permission
to expand tool authority or bypass approvals. Runtime request recording retains the exact source
block sent for that request.

Input cost is the fixed introduction plus the JSON-escaped text, at most 8 KiB before escaping.
It is sent on each request while nonempty. Updating the text or hash changes the prompt prefix
from this section; preceding static safety instructions stay unchanged. The plugin does not
promise cache hits or append-only personal-instruction history.

Invalid or unreadable sources fail before the model request with:

```text
Cannot load personal instructions safely; check the saved text, SHA-256 and 8 KiB limit
```

Cancellation is checked before and after the trusted reader. Host exceptions and source paths
are not reflected. File ownership, permissions, atomic saves, backup and restore belong to the
desktop host. See [ADR 0049](../../../docs/decisions/0049-personal-instructions-and-skill-library.md).
