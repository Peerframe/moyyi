import { describe, expect, it } from "vitest";
import { TRAFFIC_LIGHTS, windowChrome } from "./window-chrome.ts";

describe("window chrome", () => {
  it("puts the traffic lights in the rail over the macOS sidebar material", () => {
    expect(windowChrome("darwin")).toEqual({
      titleBarStyle: "hidden",
      trafficLightPosition: TRAFFIC_LIGHTS,
      vibrancy: "sidebar",
      visualEffectState: "followWindow",
      backgroundColor: "#00000000",
    });
  });

  it("keeps the system frame on a solid background elsewhere", () => {
    expect(windowChrome("linux")).toEqual({ backgroundColor: "#ffffff" });
    expect(windowChrome("win32")).toEqual({ backgroundColor: "#ffffff" });
  });
});
