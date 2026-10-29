import { parseDesktopCommand } from "../../host/validation.ts";
import type { NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async configure(context, value) {
      const options = contract.channels.configure.validate(value, parseDesktopCommand);
      if (context.selecting || context.quitting) throw Error("请先完成或取消当前选择。 ");
      const command = parseDesktopCommand({ ...options, type: "configure" });
      return context.host.send(command);
    },
  },
} satisfies NativeFeature;
