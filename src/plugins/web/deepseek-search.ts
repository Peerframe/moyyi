/** The auxiliary request contains only the approved query, never conversation history. */
export const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/anthropic/v1/messages";
export const DEEPSEEK_SEARCH_COST = "将产生一次 DeepSeek Flash 付费调用，外加最多 5 次计费搜索";

export function deepSeekSearchRequest(query: string) {
  return {
    model: "deepseek-flash",
    max_tokens: 4096,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: `Perform a web search for the query: ${query}` }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  } as const;
}
