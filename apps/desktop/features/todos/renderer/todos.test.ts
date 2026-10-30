import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MessageList } from "../../../renderer/MessageList.tsx";

it("renders every item as model-reported data and folds only older lists", () => {
  const text = `todo_write ${JSON.stringify({
    todos: [
      { content: "<img src=x>", status: "pending" },
      { content: "Check", status: "in_progress" },
      { content: "Read", status: "completed" },
    ],
  })}`;
  const html = renderToStaticMarkup(
    createElement(MessageList, {
      messages: [
        { id: "old", role: "tool", tool: "todo_write", state: "requested", text },
        {
          id: "result",
          role: "tool",
          tool: "todo_write",
          state: "succeeded",
          text: "Updated todo list",
        },
        { id: "new", role: "tool", tool: "todo_write", state: "requested", text },
      ],
      historyTruncated: false,
      streamText: "",
      running: false,
    }),
  );
  expect(html.match(/ open=""/g)).toHaveLength(1);
  expect(html.match(/&lt;img src=x&gt;/g)).toHaveLength(2);
  expect(html).toContain("待办");
  expect(html).toContain("进行中");
  expect(html).toContain("已完成");
  expect(html).toContain("不代表已核实");
  expect(html).not.toContain("<img");
});
