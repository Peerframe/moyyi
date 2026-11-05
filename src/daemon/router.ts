import type {
  ClientCommand,
  EffectId,
  RunId,
  RuntimeEvent,
  SessionId,
} from "../contracts/index.ts";

/**
 * Decides which connected clients receive each runtime event. The runtime protocol was written
 * for one client: replies such as `session.ready` or `command.rejected` carry no recipient. The
 * daemon serializes commands, so an event emitted while client X's command is being handled is
 * a reply to X. Everything else is routed to the clients viewing the event's session, so one
 * client's prompts, history and approvals never appear in another client's unrelated session.
 */
export class EventRouter {
  readonly #viewing = new Map<number, SessionId | undefined>();
  readonly #runSession = new Map<RunId, SessionId>();
  readonly #effectRun = new Map<EffectId, RunId>();
  readonly #runOwner = new Map<RunId, number>();
  #active: { readonly client: number; readonly command: ClientCommand } | undefined;

  add(client: number): void {
    this.#viewing.set(client, undefined);
  }

  /** Returns runs this client started that are still active, for cancellation on disconnect. */
  remove(client: number): RunId[] {
    this.#viewing.delete(client);
    if (this.#active?.client === client) this.#active = undefined;
    return [...this.#runOwner].filter(([, owner]) => owner === client).map(([run]) => run);
  }

  get clients(): readonly number[] {
    return [...this.#viewing.keys()];
  }

  begin(client: number, command: ClientCommand): void {
    if (this.#active) throw Error("Daemon commands are serialized");
    this.#active = { client, command };
  }

  end(client: number): void {
    if (this.#active?.client === client) this.#active = undefined;
  }

  /** Records run/effect ownership from the event and returns its recipients. */
  route(event: RuntimeEvent): readonly number[] {
    const active = this.#active;
    switch (event.type) {
      case "session.ready":
        if (!active) return [];
        this.#viewing.set(active.client, event.sessionId);
        return [active.client];
      case "session.listed":
      case "session.results":
        return active ? [active.client] : [];
      case "command.rejected":
        return active ? [active.client] : this.clients;
      case "plugin.status":
        return this.clients;
      case "run.started":
        this.#runSession.set(event.runId, event.sessionId);
        if (active?.command.type === "run.start" || active?.command.type === "session.compact")
          this.#runOwner.set(event.runId, active.client);
        return this.#viewers(event.sessionId);
      case "entry.appended":
        // Recorded history replayed by session.load belongs to the loading client only.
        if (active?.command.type === "session.load") return [active.client];
        return this.#viewers(event.entry.sessionId);
      case "assistant.delta":
        return this.#runViewers(event.runId);
      case "effect.updated":
        this.#effectRun.set(event.effect.id, event.effect.runId);
        return this.#runViewers(event.effect.runId);
      case "approval.requested": {
        const run = this.#effectRun.get(event.effectId);
        const viewers = run && this.#runSession.has(run) ? this.#runViewers(run) : [];
        // An approval nobody sees would only wait for the run's deadline, e.g. one from a
        // sub-agent's child session; show it to everyone instead.
        return viewers.length ? viewers : this.clients;
      }
      case "run.finished": {
        const recipients = this.#runViewers(event.runId);
        this.#runSession.delete(event.runId);
        this.#runOwner.delete(event.runId);
        for (const [effect, run] of this.#effectRun)
          if (run === event.runId) this.#effectRun.delete(effect);
        return recipients;
      }
    }
  }

  #viewers(session: SessionId): number[] {
    return [...this.#viewing].filter(([, viewed]) => viewed === session).map(([id]) => id);
  }

  #runViewers(run: RunId): number[] {
    const session = this.#runSession.get(run);
    return session === undefined ? [] : this.#viewers(session);
  }
}
