// Starts moyyi Chat on the mock backend. URL parameters pick what to show, so every board has a
// reproducible scene: ?scene=day|first-run|offline|loading, ?theme=dark|light, ?chat=<id>,
// ?page=results[/<id>]|settings[/<section>]|plugins[/<plugin>], ?play. ?chrome=mac leaves the
// rail's top strip to window controls and the window ground transparent, as the desktop app does.
import { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { chosen } from "./mock/page-actions.ts";
import { createMockPort } from "./mock/port.ts";
import { firstRunWorld, xiaowenWorld } from "./mock/world.ts";
import type { ChatWorld, Theme } from "./port.ts";
import { App } from "./ui/App.tsx";

const params = new URLSearchParams(location.search);
const scene = params.get("scene") ?? "day";
const mac = params.get("chrome") === "mac";

function sceneWorld(): ChatWorld {
  if (scene === "first-run") return firstRunWorld();
  const world = xiaowenWorld();
  if (scene === "offline") return { ...world, connection: { state: "offline" } };
  if (scene === "loading") return { ...world, connection: { state: "loading" }, chats: [] };
  return world;
}

const port = createMockPort(sceneWorld());

// ?theme pins a theme. Otherwise 设置 › 通用 › 颜色 decides; 跟随系统 follows the system, also when
// it changes while the window is open.
const asked = params.get("theme");
const lightQuery = matchMedia("(prefers-color-scheme: light)");

function currentTheme(): Theme {
  if (asked === "light" || asked === "dark") return asked;
  const picked = chosen(port.world(), "general.theme");
  if (picked === "深色") return "dark";
  if (picked === "浅色") return "light";
  return lightQuery.matches ? "light" : "dark";
}

function watchTheme(onChange: () => void): () => void {
  lightQuery.addEventListener("change", onChange);
  const stop = port.subscribe(onChange);
  return () => {
    lightQuery.removeEventListener("change", onChange);
    stop();
  };
}
if (params.has("play")) port.play(Number(params.get("play")) || 1);

function currentFontSize(): 13 | 15 | 17 {
  const size = chosen(port.world(), "general.size");
  return size === "17" ? 17 : size === "13" ? 13 : 15;
}

function Root() {
  const theme = useSyncExternalStore(watchTheme, currentTheme);
  const fontSize = useSyncExternalStore(port.subscribe, currentFontSize);
  useEffect(() => {
    document.documentElement.className = `mc-${theme}`;
  }, [theme]);
  return (
    <div className={mac ? "desktop-chat-root ch-native-mac" : "ch-root"}>
      <App
        port={port}
        theme={theme}
        fontSize={fontSize}
        windowControls={mac}
        initialChat={params.get("chat") ?? undefined}
        initialPage={params.get("page") ?? undefined}
      />
    </div>
  );
}

document.documentElement.className = `mc-${currentTheme()}`;
const root = document.getElementById("root");
if (!root) throw new Error("moyyi Chat root element is missing.");
createRoot(root).render(<Root />);
