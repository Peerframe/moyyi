import type { EvalTask } from "../harness/types.ts";
import { accessibleNames } from "./accessible-names/task.ts";
import { ambiguousCleanup } from "./ambiguous-cleanup/task.ts";
import { conflictingLedger } from "./conflicting-ledger/task.ts";
import { contradictoryTests } from "./contradictory-tests/task.ts";
import { deduplicateRoster } from "./deduplicate-roster/task.ts";
import { deploymentCredentialsStop } from "./deployment-credentials-stop/task.ts";
import { documentFormatRetention } from "./document-format-retention/task.ts";
import { documentPacketInjection } from "./document-packet-injection/task.ts";
import { englishPage } from "./english-page/task.ts";
import { fixRangeOffByOne } from "./fix-range-off-by-one/task.ts";
import { gitHistoryCiRepair } from "./git-history-ci-repair/task.ts";
import { greetWithTranslations } from "./greet-with-translations/task.ts";
import { homeworkKeepFormat } from "./homework-keep-format/task.ts";
import { jsToTsSplit } from "./js-to-ts-split/task.ts";
import { listenerLeak } from "./listener-leak/task.ts";
import { listingSheet } from "./listing-sheet/task.ts";
import { metadataBatchRename } from "./metadata-batch-rename/task.ts";
import { nodeUpgrade } from "./node-upgrade/task.ts";
import { obsoleteEngineCleanup } from "./obsolete-engine-cleanup/task.ts";
import { offlineProjectComparison } from "./offline-project-comparison/task.ts";
import { quotedCsvExport } from "./quoted-csv-export/task.ts";
import { releaseEvidenceAudit } from "./release-evidence-audit/task.ts";
import { releaseNotesTransform } from "./release-notes-transform/task.ts";
import { remainingWork } from "./remaining-work/task.ts";
import { researchConstraintFollowup } from "./research-constraint-followup/task.ts";
import { researchSourceInjection } from "./research-source-injection/task.ts";
import { shortSummary } from "./short-summary/task.ts";
import { staleCacheCleanup } from "./stale-cache-cleanup/task.ts";
import { vaultMove } from "./vault-move/task.ts";
import { websiteSourceInjection } from "./website-source-injection/task.ts";

export const tasks: readonly EvalTask[] = [
  fixRangeOffByOne,
  listenerLeak,
  contradictoryTests,
  greetWithTranslations,
  jsToTsSplit,
  nodeUpgrade,
  englishPage,
  accessibleNames,
  homeworkKeepFormat,
  listingSheet,
  staleCacheCleanup,
  vaultMove,
  remainingWork,
  shortSummary,
  obsoleteEngineCleanup,
  gitHistoryCiRepair,
  websiteSourceInjection,
  deploymentCredentialsStop,
  offlineProjectComparison,
  researchSourceInjection,
  researchConstraintFollowup,
  releaseEvidenceAudit,
  documentPacketInjection,
  documentFormatRetention,
  releaseNotesTransform,
  deduplicateRoster,
  quotedCsvExport,
  conflictingLedger,
  metadataBatchRename,
  ambiguousCleanup,
];
