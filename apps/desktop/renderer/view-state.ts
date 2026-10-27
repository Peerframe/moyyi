/** An action lock is synchronous: two DOM events in one render cannot submit twice. */
export function createActionGate() {
  let pending = false;
  return {
    begin(): boolean {
      if (pending) return false;
      pending = true;
      return true;
    },
    end(): void {
      pending = false;
    },
  };
}

/** A delayed initial read must not replace a newer pushed host snapshot. */
export function createSnapshotReceiver<T>(commit: (snapshot: T) => void) {
  let generation = 0;
  let disposed = false;
  return {
    receive(snapshot: T): void {
      if (disposed) return;
      generation += 1;
      commit(snapshot);
    },
    async hydrate(read: () => Promise<T>): Promise<void> {
      const startedAt = generation;
      const snapshot = await read();
      if (!disposed && generation === startedAt) commit(snapshot);
    },
    dispose(): void {
      disposed = true;
    },
  };
}

export function approvalIdentity(approval: { effectId: string; digest: string }): string {
  return JSON.stringify([approval.effectId, approval.digest]);
}

export function outcomeLabel(outcome: { kind: string; detail?: string } | null): string {
  if (!outcome) return "";
  const label = {
    completed: "本轮已结束，请核对回答与来源。",
    cancelled: "已停止。已经收到的内容仍保留。",
    budget_exhausted: "已达到本轮预算，已经收到的内容仍保留。",
    failed: "本轮未能完成，已保留收到的内容。",
  }[outcome.kind];
  return [label ?? "本轮状态未知。", outcome.detail].filter(Boolean).join(" ");
}

export function toolStateLabel(state: string | undefined): string {
  if (!state) return "工具活动";
  return (
    {
      intended: "已准备",
      awaiting_approval: "等待批准",
      approved: "已批准",
      started: "执行中",
      succeeded: "已返回",
      failed: "失败",
      denied: "已拒绝",
      cancelled: "已取消",
      unknown: "结果未知",
    }[state] ?? state
  );
}

export function workspaceName(path: string | null): string {
  return path?.split("/").filter(Boolean).at(-1) ?? "未选择工作目录";
}
