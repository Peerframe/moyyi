export function canPublish(hostGrants) {
  return hostGrants.has("publish");
}
