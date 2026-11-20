"use client";

import clsx from "clsx";
import type { Hop } from "@/lib/net/simulate";

export function TraceView({ hops, compact }: { hops: Hop[]; compact?: boolean }) {
  return (
    <ol>
      {hops.map((h, i) => (
        <li key={i} className="relative flex gap-3 pb-3.5 last:pb-0">
          {i < hops.length - 1 && <span className="absolute top-3 bottom-0 left-[4.5px] w-px bg-line" />}
          <span
            className={clsx(
              "relative mt-[5px] size-[10px] shrink-0 rounded-full border-2 bg-surface",
              h.status === "ok" ? "border-ok" : h.status === "fail" ? "border-err bg-err" : "border-faint",
            )}
          />
          <div className="min-w-0">
            <div className={clsx("font-medium", h.status === "fail" && "text-err")}>{h.title}</div>
            {h.detail && <div className={clsx("mt-0.5 text-muted", compact ? "text-[12px]" : "text-[12.5px] leading-relaxed")}>{h.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
