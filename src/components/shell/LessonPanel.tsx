"use client";

import clsx from "clsx";
import { CheckCircle2, ChevronDown, GraduationCap, Minus, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { GLOSSARY } from "@/lib/glossary";
import { LESSONS, runChecks, type CheckOutcome } from "@/lib/lessons";
import { useStore } from "@/lib/store";
import { TraceView } from "../TraceView";
import { Button, Term } from "../ui";

export function LessonPanel() {
  const { activeLessonId, lessonPanelOpen, setLessonPanelOpen, scenario, completeLesson, completed, exitLesson } = useStore();
  const lesson = LESSONS.find((l) => l.id === activeLessonId);
  const [hintCount, setHintCount] = useState(0);
  const [results, setResults] = useState<CheckOutcome[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setHintCount(0);
    setResults(null);
    setExpanded(null);
  }, [activeLessonId]);

  // 設定を変えたら判定結果は古くなる
  useEffect(() => setResults(null), [scenario]);

  if (!lesson) return null;

  if (!lessonPanelOpen) {
    return (
      <button
        onClick={() => setLessonPanelOpen(true)}
        className="fixed bottom-4 left-[68px] z-40 flex h-9 items-center gap-2 rounded border border-line bg-surface px-3 font-medium shadow-lg hover:bg-hover"
      >
        <GraduationCap size={15} className="text-accent" /> {lesson.title}
      </button>
    );
  }

  const passed = results?.filter((r) => r.passed).length ?? 0;
  const check = () => {
    const r = runChecks(lesson, scenario);
    setResults(r);
    setExpanded(r.findIndex((x) => !x.passed));
    if (r.every((x) => x.passed)) completeLesson(lesson.id);
  };

  return (
    <aside className="fixed bottom-4 left-[68px] z-40 flex max-h-[calc(100dvh-6rem)] w-[min(380px,calc(100vw-5rem))] flex-col rounded-lg border border-line bg-surface shadow-[0_8px_32px_rgba(0,0,0,0.16)]">
      <header className="flex h-11 items-center gap-2 border-b border-line px-4">
        <span className="text-[12px] text-muted">学習</span>
        <h2 className="flex-1 truncate font-semibold">{lesson.title}</h2>
        {completed.includes(lesson.id) && <CheckCircle2 size={15} className="text-ok" />}
        <button onClick={() => setLessonPanelOpen(false)} className="rounded p-1 text-muted hover:bg-hover hover:text-fg" aria-label="最小化">
          <Minus size={15} />
        </button>
      </header>
      <div className="space-y-4 overflow-y-auto px-4 py-3">
        <p className="leading-relaxed text-fg-2">{lesson.story}</p>
        <div>
          <h3 className="mb-1 text-[12px] font-medium text-muted">ゴール</h3>
          <ul className="space-y-0.5">
            {lesson.goals.map((g) => (
              <li key={g} className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
                {g}
              </li>
            ))}
          </ul>
        </div>
        {lesson.firstSteps && (
          <div>
            <h3 className="mb-1 text-[12px] font-medium text-muted">まずやってみよう</h3>
            <ol className="space-y-1">
              {lesson.firstSteps.map((f, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] text-fg-2">
                  <span className="tnum mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{i + 1}</span>
                  {f}
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {lesson.concepts.map((c) => (
            <span key={c} className="inline-flex items-center gap-1">
              {GLOSSARY[c]?.term ?? c} <Term id={c} />
            </span>
          ))}
        </div>

        {hintCount > 0 && (
          <ol className="space-y-1.5 border-l-2 border-warn pl-3">
            {lesson.hints.slice(0, hintCount).map((h, i) => (
              <li key={i} className="text-[12.5px] text-fg-2">
                {h}
              </li>
            ))}
          </ol>
        )}

        {results && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="font-medium text-muted">判定結果</span>
              <span className={passed === results.length ? "font-medium text-ok" : "text-muted"}>
                {passed === results.length ? "クリア" : `${passed} / ${results.length}`}
              </span>
            </div>
            <div className="divide-y divide-line-soft rounded border border-line">
              {results.map((r, i) => (
                <div key={i}>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-hover" onClick={() => setExpanded(expanded === i ? null : i)}>
                    {r.passed ? <CheckCircle2 size={14} className="shrink-0 text-ok" /> : <XCircle size={14} className="shrink-0 text-err" />}
                    <span className="flex-1">{r.check.label}</span>
                    <ChevronDown size={14} className={clsx("text-muted transition-transform", expanded === i && "rotate-180")} />
                  </button>
                  {expanded === i && (
                    <div className="bg-surface-2 px-3 py-3">
                      <p className="mb-3 text-[12px] text-muted">
                        期待: {"discover" in r.check ? (r.check.expect ? "見つかる" : "見つからない") : r.check.expect ? "到達できる" : "遮断される"} · 結果: {r.result.summary}
                      </p>
                      <TraceView hops={r.result.hops} compact />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="ghost" className="px-2" onClick={() => setHintCount((n) => Math.min(n + 1, lesson.hints.length))} disabled={hintCount >= lesson.hints.length}>
          ヒント {hintCount}/{lesson.hints.length}
        </Button>
        <button onClick={exitLesson} className="text-[12px] text-muted hover:text-fg">
          終了
        </button>
        <Button variant="primary" className="ml-auto" onClick={check}>
          判定
        </Button>
      </footer>
    </aside>
  );
}
