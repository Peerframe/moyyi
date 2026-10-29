import { defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "maintenance",
  stateKeys,
  commands: commandTypes,
  async handle() {},
});
