"use client";

import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DijkstraLab, LpmLab, StpLab, SubnetDrill } from "@/components/theory/algoLabs";
import { ArpLab, CaptureLab, DhcpLab, DnsLab, OsiLab, TcpLab } from "@/components/theory/labs";
import { Quiz } from "@/components/theory/Quiz";
import { CourseLayout, CourseUnit, LearningHeader } from "@/components/learning/CourseLayout";
import { Card } from "@/components/ui";
import { useStore } from "@/lib/store";
import { UNITS } from "@/lib/theory/units";

const LABS: Record<string, () => React.ReactNode> = {
  osi: () => <OsiLab />,
  capture: () => <CaptureLab />,
  arp: () => <ArpLab />,
  subnet: () => <SubnetDrill />,
  lpm: () => <LpmLab />,
  ospf: () => <DijkstraLab />,
  stp: () => <StpLab />,
  dhcp: () => <DhcpLab />,
  tcp: () => <TcpLab />,
  dns: () => <DnsLab />,
};

export default function TheoryPage() {
  const [unitId, setUnitId] = useState(UNITS[0].id);
  const theoryDone = useStore((s) => s.theoryDone);
  const completeTheory = useStore((s) => s.completeTheory);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("unit");
    if (u && UNITS.some((x) => x.id === u)) setUnitId(u);
  }, []);
  const select = (id: string) => {
    setUnitId(id);
    window.history.replaceState(null, "", `/theory?unit=${id}`);
    document.querySelector("main")?.scrollTo({ top: 0 });
  };
  const unit = UNITS.find((u) => u.id === unitId)!;
  const done = theoryDone.includes(unit.id);
  const onComplete = useCallback(() => completeTheory(unit.id), [completeTheory, unit.id]);

  return (
    <>
      <LearningHeader course="theory" progress={`${theoryDone.length} / ${UNITS.length} クリア`} />
      <CourseLayout label="基礎理論の単元" units={UNITS.map((item, i) => (
        <CourseUnit key={item.id} title={item.title} detail={item.layer} index={i + 1}
          selected={item.id === unitId} completed={theoryDone.includes(item.id)} onSelect={() => select(item.id)} />
      ))}>
        <Card className="p-5">
          <div className="mb-1 text-[12px] text-muted">{unit.layer}</div>
          <h2 className="mb-3 text-[18px] font-semibold">{unit.title}</h2>
          <div className="space-y-2 leading-relaxed text-fg-2">
            {unit.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Card>
        <Card title="やってみる" className="overflow-hidden">
          <div className="px-5 pb-5">{LABS[unit.id]?.()}</div>
        </Card>
        <Card title="確認問題" action={done ? <span className="inline-flex items-center gap-1 text-[12px] text-ok"><CheckCircle2 size={13} /> クリア済み</span> : undefined}>
          <div className="px-5 pb-5">
            <Quiz key={unit.id} questions={unit.quiz} done={done} onComplete={onComplete} />
          </div>
        </Card>
      </CourseLayout>
    </>
  );
}
