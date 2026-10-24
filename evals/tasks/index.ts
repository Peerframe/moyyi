import type { EvalTask } from "../harness/types.ts";
import { accessibleNames } from "./accessible-names/task.ts";
import { contradictoryTests } from "./contradictory-tests/task.ts";
import { englishPage } from "./english-page/task.ts";
import { fixRangeOffByOne } from "./fix-range-off-by-one/task.ts";
import { greetWithTranslations } from "./greet-with-translations/task.ts";
import { homeworkKeepFormat } from "./homework-keep-format/task.ts";
import { jsToTsSplit } from "./js-to-ts-split/task.ts";
import { listenerLeak } from "./listener-leak/task.ts";
import { listingSheet } from "./listing-sheet/task.ts";
import { nodeUpgrade } from "./node-upgrade/task.ts";
import { remainingWork } from "./remaining-work/task.ts";
import { shortSummary } from "./short-summary/task.ts";
import { staleCacheCleanup } from "./stale-cache-cleanup/task.ts";
import { vaultMove } from "./vault-move/task.ts";

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
];
