import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";
export const hostFeature = defineHostFeature({
  id: "preferences",
  commands: commandTypes,
  stateKeys,
  async handle(host, command) {
    const p = host.preferences;
    if (!p) throw new BoundaryError("此主机未配置个人指令和 Skills 库。");
    switch (command.type) {
      case "preferences.load":
        host.update({ preferences: await p.snapshot() });
        return;
      case "personal.save":
        host.update({ preferences: await p.savePersonal(command.text) });
        return;
      case "skill.inspect":
        host.update({ preferences: await p.inspectSkill(command.directory) });
        return;
      case "skill.import":
        host.update({ preferences: await p.importSkill(command.reviewId) });
        return;
      case "skill.enable":
        host.update({ preferences: await p.setSkillEnabled(command.sha256, command.enabled) });
        return;
      case "skill.dismiss":
        host.update({ preferences: await p.dismiss() });
        return;
    }
  },
});
