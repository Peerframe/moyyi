// Serialize page actions until the port confirms the outcome. Only the originating control
// displays its result; neither the key nor the personal text is part of the feedback state.
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { actionError } from "./integration.ts";

interface Notice {
  id: string;
  phase: "pending" | "error" | "saved";
  text: string;
}
interface PageOperation {
  notice: Notice | null;
  run(id: string, work: () => Promise<void>, saved?: string): Promise<boolean>;
  clear(id: string): void;
}

const Context = createContext<PageOperation | null>(null);

export function PageOperationScope({ children }: { readonly children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const inFlight = useRef(false);

  async function run(id: string, work: () => Promise<void>, saved?: string) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setNotice({ id, phase: "pending", text: "正在处理…" });
    try {
      await work();
      setNotice(saved ? { id, phase: "saved", text: saved } : null);
      return true;
    } catch (cause) {
      setNotice({ id, phase: "error", text: actionError(cause) });
      return false;
    } finally {
      inFlight.current = false;
    }
  }

  function clear(id: string) {
    setNotice((current) => (current?.id === id && current.phase !== "pending" ? null : current));
  }

  return <Context value={{ notice, run, clear }}>{children}</Context>;
}

export function usePageOperation(id: string) {
  const context = useContext(Context);
  if (!context) throw Error("Page actions require a page scope");
  return {
    busy: context.notice?.phase === "pending",
    notice: context.notice?.id === id ? context.notice : null,
    run: (work: () => Promise<void>, saved?: string) => context.run(id, work, saved),
    clear: () => context.clear(id),
  };
}

export function ActionFeedback({
  notice,
  disabledReason,
  retry,
}: {
  readonly retry?: string;
  readonly notice: Notice | null;
  readonly disabledReason?: string | undefined;
}) {
  const pending = useContext(Context)?.notice?.phase === "pending";
  if (!notice && (pending || !disabledReason)) return null;
  return (
    <span
      className="ch-action-feedback ch-line-sub"
      role={notice ? (notice.phase === "error" ? "alert" : "status") : undefined}
    >
      {notice?.text ?? disabledReason}
      {notice?.phase === "error" ? retry : null}
    </span>
  );
}
