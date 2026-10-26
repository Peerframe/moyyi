import { decodeArchive, decodeDelivery } from "./decode.mjs";
import { canPublish } from "./policy.mjs";

export function archiveRequest(text, hostGrants) {
  const card = decodeArchive(text);
  return {
    label: card.title,
    document: card.source,
    publish: canPublish(hostGrants),
  };
}

export function deliveryRequest(text, hostGrants) {
  const card = decodeDelivery(text);
  return {
    label: card.title,
    document: card.body,
    publish: canPublish(hostGrants),
  };
}
