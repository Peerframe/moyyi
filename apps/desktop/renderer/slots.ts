import { createElement, Fragment } from "react";
import type { DesktopMessage } from "../shared.ts";
import { rendererFeatures } from "./feature-registry.ts";
import type {
  MessageRenderer,
  RendererFeature,
  SettingsSectionProps,
  SlotId,
} from "./slot-types.ts";
import { SLOT_NAMES } from "./slot-types.ts";

/** Pure construction makes accidental duplicate registrations fail at startup and in tests. */
export function createSlots(features: readonly RendererFeature[]) {
  const ids = new Set<string>();
  const messages = new Map<string, MessageRenderer>();
  const claim = (id: string) => {
    if (ids.has(id)) throw Error(`Duplicate desktop contribution: ${id}`);
    ids.add(id);
  };
  for (const feature of features) {
    claim(`feature:${feature.id}`);
    for (const slot of feature.slots ?? []) {
      if (!SLOT_NAMES.includes(slot.slot)) throw Error(`Unknown desktop slot: ${slot.slot}`);
      claim(`slot:${slot.id}`);
    }
    for (const section of feature.settingsSections ?? []) claim(`settings:${section.id}`);
    for (const node of feature.messages ?? []) {
      claim(`message:${node.id}`);
      if (!node.tool && !node.role) throw Error(`Missing message selector: ${node.id}`);
      const key = node.tool ? `tool:${node.tool}` : `role:${node.role}`;
      if (messages.has(key)) throw Error(`Duplicate desktop message selector: ${key}`);
      messages.set(key, node);
    }
  }
  const contributions = features
    .flatMap((feature) => feature.slots ?? [])
    .sort((a, b) => a.order - b.order);
  const settings = features
    .flatMap((feature) => feature.settingsSections ?? [])
    .sort((a, b) => a.order - b.order);
  return {
    contributions(slot: SlotId) {
      return contributions.filter((item) => item.slot === slot);
    },
    settings,
    message(message: DesktopMessage) {
      return (
        (message.tool ? messages.get(`tool:${message.tool}`) : undefined) ??
        messages.get(`role:${message.role}`)
      );
    },
  };
}
// The generated list is fixed for the lifetime of this build; no runtime plugin loading.
let registered: ReturnType<typeof createSlots> | undefined;
function registeredSlots() {
  registered ??= createSlots(rendererFeatures);
  return registered;
}
export function FeatureSlot({ name }: { name: SlotId }) {
  return createElement(
    Fragment,
    null,
    ...registeredSlots()
      .contributions(name)
      .map(({ id, Component }) => createElement(Component, { key: id })),
  );
}
export function SettingsSections(props: SettingsSectionProps) {
  return createElement(
    Fragment,
    null,
    ...registeredSlots().settings.map(({ id, Component }) =>
      createElement(Component, { key: id, ...props }),
    ),
  );
}
export function ConversationNode({ message }: { message: DesktopMessage }) {
  const node = registeredSlots().message(message);
  if (!node) throw Error(`No desktop renderer for ${message.role}`);
  return createElement(node.Component, { message });
}
