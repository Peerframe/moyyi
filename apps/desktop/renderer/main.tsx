import { createRoot } from "react-dom/client";
import { DesktopChatApp } from "./ChatApp.tsx";
import "./chat.css";

const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element is missing.");
if (!window.moyyi) {
  root.textContent = "桌面桥接未能加载。请从已安装的 moyyi 应用打开。";
} else {
  createRoot(root).render(<DesktopChatApp bridge={window.moyyi} />);
}
