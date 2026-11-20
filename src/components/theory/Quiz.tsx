"use client";

import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { Question } from "@/lib/theory/units";
import { Button } from "../ui";

/** 確認問題。全問正解で onComplete */
export function Quiz({ questions, onComplete, done }: { questions: Question[]; onComplete: () => void; done: boolean }) {
  const [picked, setPicked] = useState<(number | null)[]>(questions.map(() => null));
  useEffect(() => setPicked(questions.map(() => null)), [questions]);
  const allCorrect = picked.every((p, i) => p === questions[i].answer);
  useEffect(() => {
    if (allCorrect && !done) onComplete();
  }, [allCorrect, done, onComplete]);

  return (
    <div className="space-y-4">
      {questions.map((q, i) => {
        const p = picked[i];
        return (
          <div key={i}>
            <div className="mb-2 font-medium">
              Q{i + 1}. {q.q}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {q.choices.map((c, j) => (
                <button
                  key={j}
                  onClick={() => setPicked((x) => x.map((v, k) => (k === i ? j : v)))}
                  className={clsx(
                    "flex items-center gap-2 rounded border px-3 py-2 text-left transition-colors",
                    p === j ? (j === q.answer ? "border-ok bg-ok/10" : "border-err bg-err/10") : "border-line bg-surface hover:bg-hover",
                  )}
                >
                  {p === j && (j === q.answer ? <CheckCircle2 size={14} className="shrink-0 text-ok" /> : <XCircle size={14} className="shrink-0 text-err" />)}
                  {c}
                </button>
              ))}
            </div>
            {p !== null && <p className={clsx("mt-1.5 text-[12.5px]", p === q.answer ? "text-ok" : "text-err")}>{p === q.answer ? `正解: ${q.explain}` : "もう一度考えてみましょう。"}</p>}
          </div>
        );
      })}
      {allCorrect && (
        <div className="flex items-center gap-2 rounded border border-ok/40 bg-ok/10 px-3 py-2 font-medium text-ok">
          <CheckCircle2 size={15} /> 全問正解！ このユニットをクリアしました。
          <Button className="ml-auto" onClick={() => setPicked(questions.map(() => null))}>
            やり直す
          </Button>
        </div>
      )}
    </div>
  );
}
