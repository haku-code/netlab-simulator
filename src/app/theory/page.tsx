"use client";

import clsx from "clsx";
import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DijkstraLab, LpmLab, StpLab, SubnetDrill } from "@/components/theory/algoLabs";
import { ArpLab, CaptureLab, DhcpLab, DnsLab, OsiLab, TcpLab } from "@/components/theory/labs";
import { Quiz } from "@/components/theory/Quiz";
import { CourseTabs } from "@/components/theory/CourseTabs";
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-[15px] font-semibold">学習</h1>
        <CourseTabs value="theory" />
        <span className="ml-auto text-[12px] text-muted">
          {theoryDone.length} / {UNITS.length} クリア
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="h-fit rounded-lg border border-line bg-surface p-1.5 lg:sticky lg:top-0">
          {UNITS.map((u, i) => (
            <button
              key={u.id}
              onClick={() => select(u.id)}
              className={clsx("flex w-full items-center gap-2 rounded px-2.5 py-2 text-left transition-colors", u.id === unitId ? "bg-accent-soft text-accent" : "hover:bg-hover")}
            >
              <span className="tnum w-4 text-[11px] text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.title}</span>
                <span className="block text-[11px] text-muted">{u.layer}</span>
              </span>
              {theoryDone.includes(u.id) && <CheckCircle2 size={14} className="shrink-0 text-ok" />}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
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
        </div>
      </div>
    </>
  );
}
