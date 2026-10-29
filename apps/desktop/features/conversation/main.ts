import { rendererActions } from "../../native/actions.ts";
import type { NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async act(context, command) {
      if ((context.selecting && command.type !== "material.cancel") || context.quitting)
        throw Error("请先完成或取消当前选择。 ");
      if (!rendererActions.has(command.type)) throw Error("此操作只能从原生入口发起。");
      return context.host.send(command);
    },
  },
} satisfies NativeFeature<typeof contract>;
