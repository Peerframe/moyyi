import { dialog } from "electron";
import { claimSelection, currentSession, type NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async configureWebAccess(context, command) {
      const state = await currentSession(context, command.sessionId);
      claimSelection(context);
      try {
        if (command.allowedOrigins.length > 0 || command.search === true) {
          const result = await dialog.showMessageBox(context.window, {
            type: "question",
            title: "确认当前会话的网页访问",
            message: "确认当前会话的网页读取与搜索权限？",
            detail: `${state.workspaceRoot}\n\n${command.allowedOrigins.join("\n") || "网页读取：关闭"}\n\n${command.search === true ? "网页搜索：开启。每次仍需批准，将产生一次 DeepSeek Flash 付费调用，外加最多 5 次计费搜索；每次运行最多 5 次产品搜索。仅发送搜索词；结果链接不授予网页读取权限。" : "网页搜索：关闭。"}\n\n${command.dns === "cloudflare-doh" ? "DNS：Cloudflare DoH。将网页主机名发送给 Cloudflare 解析，不向其发送页面路径或查询参数。" : "DNS：系统 DNS。使用本机配置的解析服务查询网页主机名。"}\n\n每次 GET 仍需单独批准，目标网站会收到请求路径和查询参数。不会加载子资源、执行网页脚本或携带登录凭据；不自动跟随跳转。返回正文会进入模型上下文，并可在来源面板核对。\n\n授权仅限本次会话，与报告位置及文件权限独立。重新打开会话或修改模型设置后关闭；停止任务不会撤回已发送的请求。`,
            buttons: ["取消", "启用网页访问"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) return context.host.getState();
        }
        const current = await context.host.getState();
        if (
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting ||
          current.run ||
          current.activeSessionId !== command.sessionId ||
          current.workspaceRoot !== state.workspaceRoot ||
          (command.search === true && current.searchConnectionId !== state.searchConnectionId)
        )
          throw Error("会话已变化，请重新确认网页访问。");
        return context.host.send(command);
      } finally {
        context.selecting = false;
      }
    },
  },
} satisfies NativeFeature<typeof contract>;
