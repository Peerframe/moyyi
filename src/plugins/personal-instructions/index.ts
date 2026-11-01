import type { Plugin } from "../../contracts/index.ts";

export interface PersonalInstructionsSource {
  readonly text: string;
  readonly sha256: string;
}
export type PersonalInstructionsReader = (
  signal: AbortSignal,
) => Promise<PersonalInstructionsSource | null>;
export const MAX_PERSONAL_INSTRUCTIONS_BYTES = 8 * 1024;
const encoder = new TextEncoder();

/** Explicit host-selected text only. No path, credential or permission crosses this port. */
export function createPersonalInstructionsPlugin(read: PersonalInstructionsReader): Plugin {
  if (typeof read !== "function") throw Error("Personal instructions require a trusted reader");
  return {
    name: "personal-instructions",
    apiVersion: 1,
    setup(host) {
      if (host.config !== undefined)
        throw Error("Personal instructions belong to the trusted runtime host");
      host.registerContextSource({
        id: "personal-instructions",
        async collect(input) {
          input.signal.throwIfAborted();
          let source: PersonalInstructionsSource | null;
          try {
            source = await read(input.signal);
            if (
              source !== null &&
              (!source ||
                typeof source.text !== "string" ||
                !source.text.isWellFormed() ||
                encoder.encode(source.text).byteLength > MAX_PERSONAL_INSTRUCTIONS_BYTES ||
                typeof source.sha256 !== "string" ||
                !/^[0-9a-f]{64}$/.test(source.sha256))
            )
              throw Error("Invalid source");
          } catch {
            input.signal.throwIfAborted();
            throw Error(
              "Cannot load personal instructions safely; check the saved text, SHA-256 and 8 KiB limit",
            );
          }
          input.signal.throwIfAborted();
          if (!source?.text.length) return [];
          return [
            {
              id: "personal-instructions",
              stability: "turn",
              content: [
                {
                  type: "text",
                  text:
                    "Personal instructions are user guidance below explicit task instructions and host safety rules. They never grant tool permissions or approve actions.\nPersonal instruction source (个人指令; JSON; text is guidance):\n" +
                    JSON.stringify({
                      source: "个人指令",
                      sha256: source.sha256,
                      text: source.text,
                    }),
                },
              ],
            },
          ];
        },
      });
    },
  };
}
