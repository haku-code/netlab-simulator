"use client";

import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { CourseTabs } from "@/components/theory/CourseTabs";
import { Button, PageHeader, table as t } from "@/components/ui";
import { GLOSSARY } from "@/lib/glossary";
import { LESSONS } from "@/lib/lessons";
import { useStore } from "@/lib/store";

const LEVEL = { 1: "初級", 2: "中級", 3: "上級" } as const;

export default function LessonsPage() {
  const { completed, activeLessonId, startLesson, exitLesson } = useStore();
  const router = useRouter();

  const start = (id: string) => {
    if (activeLessonId === id) return router.push("/diagnostics");
    if (!confirm("課題を開始すると、現在の構成は課題用の構成に置き換わります（サンドボックスは課題終了時に戻ります）。開始しますか？")) return;
    startLesson(id);
    router.push("/diagnostics");
  };

  return (
    <>
      <PageHeader title="学習" count={LESSONS.length}>
        <span className="mr-auto">
          <CourseTabs value="practice" />
        </span>
        <span className="text-[12px] text-muted">
          {completed.length} / {LESSONS.length} クリア
        </span>
        {activeLessonId && <Button onClick={exitLesson}>サンドボックスに戻る</Button>}
      </PageHeader>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={clsx(t.th, "w-10")}>#</th>
              <th className={t.th}>課題</th>
              <th className={t.th}>レベル</th>
              <th className={t.th}>テーマ</th>
              <th className={t.th}>状態</th>
              <th className={t.th} />
            </tr>
          </thead>
          <tbody>
            {LESSONS.map((l, i) => {
              const done = completed.includes(l.id);
              const active = activeLessonId === l.id;
              return (
                <tr key={l.id} className={clsx(active && t.sel)}>
                  <td className={clsx(t.td, "tnum text-muted")}>{i + 1}</td>
                  <td className={clsx(t.td, "whitespace-normal py-3")}>
                    <div className="font-medium">{l.title}</div>
                    <div className="text-[12px] text-muted">{l.summary}</div>
                  </td>
                  <td className={clsx(t.td, "text-fg-2")}>{LEVEL[l.level]}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{l.concepts.map((c) => GLOSSARY[c]?.term ?? c).join(", ")}</td>
                  <td className={t.td}>
                    {done ? (
                      <span className="inline-flex items-center gap-1.5 text-ok">
                        <CheckCircle2 size={14} /> クリア
                      </span>
                    ) : active ? (
                      <span className="text-accent">挑戦中</span>
                    ) : (
                      <span className="text-muted">未挑戦</span>
                    )}
                  </td>
                  <td className={clsx(t.td, "text-right")}>
                    <Button variant={active ? "secondary" : "primary"} onClick={() => start(l.id)}>
                      {active ? "続ける" : done ? "もう一度" : "開始"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
