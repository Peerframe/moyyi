// Trusted local maintenance is deliberately separate from model tools and client commands.
// Callers close their runtime first; the store still takes its own cross-process writer lock.
export {
  backupLocalStore,
  type LocalStoreReceipt,
  restoreLocalStore,
} from "../store/maintenance.ts";
