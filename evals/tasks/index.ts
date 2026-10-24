import type { EvalTask } from "../harness/types.ts";
import { fixRangeOffByOne } from "./fix-range-off-by-one/task.ts";

export const tasks: readonly EvalTask[] = [fixRangeOffByOne];
