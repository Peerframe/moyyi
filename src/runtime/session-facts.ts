import { platform } from "node:os";
import type {
  Clock,
  ContextSection,
  ModelProfile,
  SessionId,
  SessionStore,
} from "../contracts/index.ts";

/** Host facts are captured once per session/model composition, never refreshed per request. */
export function sessionFacts(store: Pick<SessionStore, "loadSession">, clock: Clock) {
  const snapshots = new Map<string, Promise<ContextSection>>();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const operatingSystem = platform();
  return (
    sessionId: SessionId,
    workspaceRoot: string,
    profile: ModelProfile,
  ): Promise<ContextSection> => {
    const key = JSON.stringify([sessionId, workspaceRoot, profile.origin]);
    let pending = snapshots.get(key);
    if (!pending) {
      pending = (async () => {
        const session = await store.loadSession(sessionId);
        const started = session?.entries[0]?.createdAt ?? clock.now();
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(started));
        return {
          id: "session-runtime-facts",
          stability: "session" as const,
          content: [
            {
              type: "text" as const,
              text: `Session runtime facts (stable snapshot, not a live clock):\nSession date: ${date}\nTime zone: ${timeZone}\nOperating system: ${operatingSystem}\nWorkspace: ${workspaceRoot}\nModel: ${profile.origin.provider}/${profile.origin.model}`,
            },
          ],
        };
      })();
      snapshots.set(key, pending);
    }
    return pending;
  };
}
