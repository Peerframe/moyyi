// Starts moyyi Chat on the mock backend. URL parameters pick what to show, so every board has a
// reproducible scene: ?scene=day|first-run|offline|loading, ?theme=dark|light, ?chat=<id>, ?play.
import { createRoot } from "react-dom/client";
import { createMockPort } from "./mock/port.ts";
import { firstRunWorld, xiaowenWorld } from "./mock/world.ts";
import type { ChatWorld, Theme } from "./port.ts";
import { App } from "./ui/App.tsx";

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "day";

function sceneWorld(): ChatWorld {
  if (scene === "first-run") return firstRunWorld();
  const world = xiaowenWorld();
  if (scene === "offline") return { ...world, connection: { state: "offline" } };
  if (scene === "loading") return { ...world, connection: { state: "loading" }, chats: [] };
  return world;
}

const asked = params.get("theme");
const theme: Theme =
  asked === "light" || asked === "dark"
    ? asked
    : matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
document.documentElement.className = `mc-${theme}`;

const port = createMockPort(sceneWorld());
if (params.has("play")) port.play(Number(params.get("play")) || 1);

const root = document.getElementById("root");
if (!root) throw new Error("moyyi Chat root element is missing.");
createRoot(root).render(
  <App
    port={port}
    theme={theme}
    sticker="./assets/character.png"
    initialChat={params.get("chat") ?? undefined}
  />,
);
