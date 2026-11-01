import { describe, expect, it } from "vitest";
import { nativeVault } from "./keychain.ts";

describe("desktop credential ownership", () => {
  it.each(["legacy-flash", "legacy-kimi-cn", "legacy-kimi-global"])(
    "refuses to delete shared %s credentials before invoking a native helper",
    async (id) => {
      const vault = nativeVault("/nonexistent/synthetic-keychain-helper", "/nonexistent/home");
      await expect(vault.remove(id)).rejects.toThrow("Invalid credential identity");
    },
  );
});
