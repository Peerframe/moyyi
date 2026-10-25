import { describe, expect, it, vi } from "vitest";
import { DEEPSEEK_RESPONSES_URL, deepSeekHttpTransport } from "./deepseek-http.ts";

const signal = () => new AbortController().signal;
describe("DeepSeek host transport", () => {
  it("uses fixed origin, disallows redirects, and exposes no credentials to the provider", async () => {
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response("data", {
          headers: {
            "content-type": "text/event-stream",
            "retry-after": "2",
            "x-secret": "private",
          },
        }),
    );
    const getApiKey = vi.fn(() => "synthetic-key");
    const transport = deepSeekHttpTransport({ getApiKey, fetch: send });
    expect(getApiKey).not.toHaveBeenCalled();
    const abort = signal();
    const response = await transport('{"stream":true}', abort);
    expect(send).toHaveBeenCalledExactlyOnceWith(DEEPSEEK_RESPONSES_URL, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: abort,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: "Bearer synthetic-key",
      },
      body: '{"stream":true}',
    });
    expect(Object.keys(response).sort()).toEqual([
      "body",
      "close",
      "contentType",
      "retryAfter",
      "status",
    ]);
    const bytes: Uint8Array[] = [];
    for await (const part of response.body) bytes.push(part);
    expect(new TextDecoder().decode(bytes[0])).toBe("data");
    await response.close();
  });
  it.each(["", "contains space", "x\ny", "中文"])(
    "rejects invalid credentials without I/O",
    async (key) => {
      const send = vi.fn<typeof fetch>();
      await expect(
        deepSeekHttpTransport({ getApiKey: () => key, fetch: send })("{}", signal()),
      ).rejects.toMatchObject({ kind: "auth", message: "DeepSeek credential access failed" });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("redacts secret-bearing credential and network exceptions", async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw Error("secret from proxy");
    });
    await expect(
      deepSeekHttpTransport({
        getApiKey: () => {
          throw Error("secret from keychain");
        },
        fetch: send,
      })("{}", signal()),
    ).rejects.toThrow("DeepSeek credential access failed");
    expect(send).not.toHaveBeenCalled();
    await expect(
      deepSeekHttpTransport({ getApiKey: () => "synthetic", fetch: send })("{}", signal()),
    ).rejects.toThrow("DeepSeek transport unavailable");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not read credentials after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const getApiKey = vi.fn(() => "synthetic");
    await expect(
      deepSeekHttpTransport({ getApiKey })("{}", controller.signal),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(getApiKey).not.toHaveBeenCalled();
  });
  it("cancels and unlocks the body on close", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const send = vi.fn<typeof fetch>(async () => new Response(stream));
    const response = await deepSeekHttpTransport({ getApiKey: () => "synthetic", fetch: send })(
      "{}",
      signal(),
    );
    expect(stream.locked).toBe(true);
    await response.close();
    await response.close();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
  it("redacts errors raised while reading the stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(Error("secret body failure"));
      },
    });
    const send = vi.fn<typeof fetch>(async () => new Response(stream));
    const response = await deepSeekHttpTransport({ getApiKey: () => "synthetic", fetch: send })(
      "{}",
      signal(),
    );
    const read = async () => {
      for await (const _part of response.body) {
        /* consume */
      }
    };
    await expect(read()).rejects.toThrow("DeepSeek stream transport failed");
  });
});
