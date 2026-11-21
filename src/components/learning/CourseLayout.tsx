import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { CourseTabs } from "@/components/theory/CourseTabs";

export function LearningHeader({ course, progress }: {
  course: ComponentProps<typeof CourseTabs>["value"];
  progress?: string;
}) {
  return (
    <div className="mb-4 flex min-h-8 flex-wrap items-center gap-3">
      <h1 className="text-[15px] font-semibold">学習</h1>
      <CourseTabs value={course} />
      {progress && <span className="ml-auto text-[12px] text-muted">{progress}</span>}
    </div>
  );
}

export function CourseLayout({ label, units, children }: { label: string; units: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label={label} className="max-h-52 overflow-y-auto rounded-lg border border-line bg-surface p-1.5 lg:sticky lg:top-0 lg:h-fit lg:max-h-[calc(100dvh-9rem)]">
        {units}
      </nav>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

export function CourseUnit({ title, detail, index, selected, completed, onSelect }: {
  title: string;
  detail: string;
  index: number;
  selected: boolean;
  completed: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect}
      className={clsx("flex w-full items-center gap-2 rounded px-2.5 py-2 text-left transition-colors", selected ? "bg-accent-soft text-accent" : "hover:bg-hover")}>
      <span className="tnum w-4 shrink-0 text-[11px] text-muted" aria-hidden>{index}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block text-[11px] text-muted">{detail}</span>
      </span>
      {completed && <CheckCircle2 size={14} className="shrink-0 text-ok" aria-label="クリア" role="img" />}
    </button>
  );
}
