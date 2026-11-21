"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { CourseLayout, CourseUnit, LearningHeader } from "@/components/learning/CourseLayout";
import { Button, Card } from "@/components/ui";
import { GLOSSARY } from "@/lib/glossary";
import { LESSONS } from "@/lib/lessons";
import { useStore } from "@/lib/store";

const LEVEL = { 1: "初級", 2: "中級", 3: "上級" } as const;

export default function LessonsPage() {
  const completed = useStore((s) => s.completed);
  const activeLessonId = useStore((s) => s.activeLessonId);
  const startLesson = useStore((s) => s.startLesson);
  const exitLesson = useStore((s) => s.exitLesson);
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const lesson = LESSONS.find((item) => item.id === (selected ?? activeLessonId)) ?? LESSONS[0];
  const active = activeLessonId === lesson.id;
  const done = completed.includes(lesson.id);

  const start = () => {
    if (!active && !confirming) {
      setConfirming(true);
      return;
    }
    if (!active) startLesson(lesson.id);
    router.push("/diagnostics");
  };

  return (
    <>
      <LearningHeader course="practice" progress={`${completed.length} / ${LESSONS.length} クリア`} />
      <CourseLayout label="実践課題" units={LESSONS.map((item, i) => (
        <CourseUnit key={item.id} title={item.title} index={i + 1}
          detail={item.id === activeLessonId ? `${LEVEL[item.level]} · 挑戦中` : LEVEL[item.level]}
          selected={lesson.id === item.id} completed={completed.includes(item.id)} onSelect={() => {
            setSelected(item.id);
            setConfirming(false);
          }} />
      ))}>
        <Card className="p-5">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
            {LEVEL[lesson.level]}
            {active && <span className="text-accent">挑戦中</span>}
            {done && <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 size={13} /> クリア済み</span>}
          </div>
          <h2 className="mb-2 text-[18px] font-semibold">{lesson.title}</h2>
          <p className="mb-2 font-medium">{lesson.summary}</p>
          <p className="leading-relaxed text-fg-2">{lesson.story}</p>
        </Card>
        <Card title="クリア条件">
          <div className="space-y-4 px-5 pb-5">
            <ul className="list-disc space-y-1 pl-5 text-fg-2">
              {lesson.goals.map((goal) => <li key={goal}>{goal}</li>)}
            </ul>
            {confirming ? (
              <div className="space-y-2 rounded border border-line bg-surface-2 p-3">
                <p role="status" className="text-fg-2">課題用の構成に切り替えます。課題を終了すると、元のサンドボックスに戻ります。</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={start}>この課題を始める</Button>
                  <Button onClick={() => setConfirming(false)}>キャンセル</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={start}>{active ? "続ける" : done ? "もう一度" : "課題を開始"}</Button>
                {activeLessonId && <Button onClick={exitLesson}>サンドボックスに戻る</Button>}
              </div>
            )}
          </div>
        </Card>
        <Card title="関連用語">
          <ul className="flex flex-wrap gap-1.5 px-5 pb-5 text-[12px] text-fg-2">
            {lesson.concepts.map((id) => <li key={id} className="rounded border border-line px-2 py-1">{GLOSSARY[id]?.term ?? id}</li>)}
          </ul>
        </Card>
      </CourseLayout>
    </>
  );
}
