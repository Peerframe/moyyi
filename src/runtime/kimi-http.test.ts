import { describe, expect, it, vi } from "vitest";
import { kimiChatUrl, kimiHttpTransport } from "./kimi-http.ts";

const signal = () => new AbortController().signal;
describe("Kimi host transport", () => {
  it("requires an exact region before reading any credential or sending", async () => {
    const getApiKey = vi.fn(() => "synthetic");
    const send = vi.fn<typeof fetch>(async () => new Response(""));
    expect(() => kimiHttpTransport({ region: "other" as "cn", getApiKey, fetch: send })).toThrow(
      "Kimi region must be cn or global",
    );
    expect(getApiKey).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await (
      await kimiHttpTransport({ region: "global", getApiKey, fetch: send })("{}", signal())
    ).close();
    expect(send.mock.calls[0]?.[0]).toBe("https://api.moonshot.ai/v1/chat/completions");
  });
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
    const transport = kimiHttpTransport({ region: "cn", getApiKey, fetch: send });
    expect(getApiKey).not.toHaveBeenCalled();
    const abort = signal();
    const response = await transport('{"stream":true}', abort);
    expect(send).toHaveBeenCalledExactlyOnceWith(kimiChatUrl("cn"), {
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
        kimiHttpTransport({ region: "cn", getApiKey: () => key, fetch: send })("{}", signal()),
      ).rejects.toMatchObject({ kind: "auth", message: "Kimi credential access failed" });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("redacts secret-bearing credential and network exceptions", async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw Error("secret from proxy");
    });
    await expect(
      kimiHttpTransport({
        region: "cn",
        getApiKey: () => {
          throw Error("secret from keychain");
        },
        fetch: send,
      })("{}", signal()),
    ).rejects.toThrow("Kimi credential access failed");
    expect(send).not.toHaveBeenCalled();
    await expect(
      kimiHttpTransport({ region: "cn", getApiKey: () => "synthetic", fetch: send })(
        "{}",
        signal(),
      ),
    ).rejects.toThrow("Kimi transport unavailable");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not read credentials after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const getApiKey = vi.fn(() => "synthetic");
    await expect(
      kimiHttpTransport({ region: "cn", getApiKey })("{}", controller.signal),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(getApiKey).not.toHaveBeenCalled();
  });
  it("cancels and unlocks the body on close", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const send = vi.fn<typeof fetch>(async () => new Response(stream));
    const response = await kimiHttpTransport({
      region: "cn",
      getApiKey: () => "synthetic",
      fetch: send,
    })("{}", signal());
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
    const response = await kimiHttpTransport({
      region: "cn",
      getApiKey: () => "synthetic",
      fetch: send,
    })("{}", signal());
    const read = async () => {
      for await (const _part of response.body) {
        /* consume */
      }
    };
    await expect(read()).rejects.toThrow("Kimi stream transport failed");
  });
});
