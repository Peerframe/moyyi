# Skills

The context-source plugin reads only host-activated Agent Skills documents through
`ContextSourceInput.skills.readEnabled()`. Runtime supplies the bounded, expiring port and performs
all filesystem and policy checks. The plugin has no file, process or network API.

Use `RuntimeOptions.skills: { root: absoluteLibraryDirectory, enabled: ["skill-name"] }` in the
trusted host file. `root/skill-name/SKILL.md` must have a matching name, valid YAML 1.2 metadata and
non-empty Markdown body. See [host setup and limits](../../../docs/skills.md).

This is an explicitly activated subset of the Agent Skills format. There is no catalog scan,
model-selected activation, installation, script execution or link/reference traversal. Every
selected document refreshes before each ordinary model request. Guidance cannot authorize tools;
`allowed-tools` is accepted as inert metadata. Parser errors stop before the model call. Denied
reads become explicit unavailable-guidance notices; missing selected documents are errors.
