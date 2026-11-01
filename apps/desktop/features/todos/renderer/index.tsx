import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { toolStateLabel } from "../../../renderer/view-state.ts";
import type { DesktopMessage } from "../../../shared.ts";

const labels = { pending: "待办", in_progress: "进行中", completed: "已完成" };
export function TodoCard({
  message,
  latest = false,
}: {
  message: DesktopMessage;
  latest?: boolean;
}) {
  let todos: { content: string; status: keyof typeof labels }[] | null = null;
  if (message.state === "requested" && message.text.startsWith("todo_write ")) {
    try {
      const data: unknown = JSON.parse(message.text.slice("todo_write ".length));
      if (
        data &&
        typeof data === "object" &&
        "todos" in data &&
        Array.isArray(data.todos) &&
        data.todos.every(
          (t) => t && typeof t.content === "string" && Object.hasOwn(labels, t.status),
        )
      )
        todos = data.todos;
    } catch {
      /* Incomplete display records never become a complete list. */
    }
  }
  return (
    <details className="tool-message" open={latest}>
      <summary>模型的任务清单 · {toolStateLabel(message.state)}</summary>
      <p className="panel-note">这是模型自己报告的进度，不代表已核实</p>
      {todos ? (
        todos.length ? (
          <ul>
            {todos.map((t) => (
              <li key={t.content}>
                <strong>{labels[t.status]}</strong> · {t.content}
              </li>
            ))}
          </ul>
        ) : (
          <p>清单为空。</p>
        )
      ) : (
        <>
          <p className="message-text">{message.text}</p>
          {message.state === "requested" ? (
            <p className="panel-note">清单参数不完整，无法展示完整列表。请查看完整历史。</p>
          ) : null}
        </>
      )}
    </details>
  );
}
export const rendererFeature: RendererFeature = {
  id: "todos",
  messages: [{ id: "todos.list", tool: "todo_write", Component: TodoCard }],
};
