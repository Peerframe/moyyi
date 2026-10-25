import type { ModelClient, ModelRequest, ModelStreamEvent } from "../../contracts/index.ts";
import { UNKNOWN_USAGE } from "../../contracts/index.ts";

/**
 * Deterministic ModelClient for tests and fault injection. Each call to `stream` consumes the
 * next scripted response. Running out of script is a test bug and fails loudly.
 */
export class ScriptedModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly #responses: (readonly ModelStreamEvent[])[];

  constructor(responses: readonly (readonly ModelStreamEvent[])[]) {
    this.#responses = [...responses];
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const events = this.#responses.shift();
    if (events === undefined) {
      throw new Error(
        `ScriptedModelClient: no scripted response for request ${this.requests.length}`,
      );
    }
    let partialOutput = false;
    let terminalEmitted = false;
    for (const event of events) {
      if (signal.aborted) break;
      // Yield to the event loop so cancellation races are observable in tests.
      await Promise.resolve();
      if (signal.aborted) break;
      if (event.type === "completed" || event.type === "error") terminalEmitted = true;
      else partialOutput = true;
      yield event;
    }
    if (signal.aborted && !terminalEmitted) {
      yield {
        type: "error",
        error: { kind: "cancelled", message: "aborted", partialOutput, usage: UNKNOWN_USAGE },
      };
    }
  }

  get remaining(): number {
    return this.#responses.length;
  }
}
