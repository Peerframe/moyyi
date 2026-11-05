/**
 * How the window frame looks. On macOS there is no separate title bar: the traffic lights sit at
 * the top of the folder rail and the system's sidebar material shows through the window
 * background, so the rail reads as frosted glass (design system: "Window material").
 * Other platforms keep the system frame on a solid background.
 */
export interface WindowChrome {
  readonly backgroundColor: string;
  readonly titleBarStyle?: "hidden";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
  readonly vibrancy?: "sidebar";
  readonly visualEffectState?: "followWindow";
}

/** Top-left of the traffic lights: centred in the 76px rail and its 34px top strip. */
export const TRAFFIC_LIGHTS = { x: 20, y: 27 } as const;

export function windowChrome(platform: string): WindowChrome {
  if (platform !== "darwin") return { backgroundColor: "#ffffff" };
  return {
    titleBarStyle: "hidden",
    trafficLightPosition: TRAFFIC_LIGHTS,
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
  };
}
