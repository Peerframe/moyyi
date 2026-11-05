/**
 * Client text for plan mode (ADR 0054), shared by the CLI and the desktop app so both record the
 * same user message. The runtime enforces the mode; this text only tells the model about it.
 */
export const PLAN_MODE_SUFFIX =
  "\n\n[Plan mode] Investigate with read-only tools and reply with a concrete, step-by-step plan. " +
  "Do not change files, run commands or call external tools: they are disabled until I approve the plan.";

/** Sent when the owner approves the plan and leaves plan mode. */
export const PLAN_EXECUTE_PROMPT =
  "The plan is approved. Carry it out now, then verify the result and report what changed.";
