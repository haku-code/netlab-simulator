"use client";

import clsx from "clsx";
import { Check, ChevronDown, Eye, Siren } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventCategory, OpsEvent } from "@/lib/ops/events";
import { ROLE_LABEL, currentAdmin, siteAllowed, useCanEdit, useOps } from "@/lib/ops/store";
import { useStore } from "@/lib/store";

export function isAlarm(e: OpsEvent, rules: Record<EventCategory, boolean>) {
  return e.severity !== "info" && rules[e.category];
}

/** 現在のサイト（課題中は課題）のイベント */
export function useSiteEvents() {
  const events = useOps((x) => x.events);
  const lesson = useStore((x) => x.activeLessonId);
  const site = useOps((x) => x.activeSiteId);
  return useMemo(() => {
    const key = lesson ? `lesson:${lesson}` : site;
    return events.filter((e) => e.siteId === key);
  }, [events, lesson, site]);
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

/** ヘッダーのサイト切り替え */
export function SiteSwitcher() {
  const ops = useOps();
  const lesson = useStore((x) => x.activeLessonId);
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const site = ops.sites.find((x) => x.id === ops.activeSiteId);
  const sites = ops.sites.filter((x) => siteAllowed(x.id, ops));
  return (
    <div ref={ref} className="relative">
      <button
        disabled={!!lesson}
        onClick={() => setOpen((v) => !v)}
        title={lesson ? "課題中はサイトを切り替えられません" : "サイトを切り替え"}
        className="flex h-7 items-center gap-1 rounded px-2 text-fg-2 hover:bg-hover disabled:hover:bg-transparent"
      >
        {site?.name ?? "サイト"}
        {!lesson && <ChevronDown size={13} className="text-muted" />}
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 w-56 rounded border border-line bg-surface py-1 shadow-lg">
          <div className="px-3 pt-1 pb-1.5 text-[11.5px] text-muted">サイト</div>
          {sites.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                setOpen(false);
                ops.switchSite(x.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
            >
              <span className="w-4 text-accent">{x.id === ops.activeSiteId && <Check size={14} />}</span>
              <span className="flex-1 truncate">{x.name}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <Link href="/settings/sites" onClick={() => setOpen(false)} className="block px-3 py-1.5 text-accent hover:bg-hover">
            サイトを管理
          </Link>
        </div>
      )}
    </div>
  );
}

/** ヘッダーのアラーム（未対応の件数） */
export function AlarmBell() {
  const events = useSiteEvents();
  const rules = useOps((x) => x.alarmRules);
  const open = events.filter((e) => isAlarm(e, rules) && !e.archived);
  const critical = open.some((e) => e.severity === "critical");
  return (
    <Link href="/logs?tab=alarms" className="relative rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title={open.length ? `未対応のアラーム ${open.length} 件` : "アラーム"}>
      <Siren size={17} strokeWidth={1.6} />
      {open.length > 0 && (
        <span className={clsx("tnum absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ring-2 ring-chrome", critical ? "bg-err" : "bg-warn")}>
          {open.length > 99 ? "99+" : open.length}
        </span>
      )}
    </Link>
  );
}

/** ヘッダーの管理者メニュー（ログイン中の管理者の切り替え） */
export function AdminMenu() {
  const ops = useOps();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const me = currentAdmin(ops);
  const initials = (me?.name ?? "?").slice(0, 2).toUpperCase();
  return (
    <div ref={ref} className="relative ml-1">
      <button
        onClick={() => setOpen((v) => !v)}
        title={me ? `${me.name}（${ROLE_LABEL[me.role]}）` : "管理者"}
        className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-2 ring-1 ring-line hover:ring-faint"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute top-9 right-0 z-50 w-60 rounded border border-line bg-surface py-1 shadow-lg">
          <div className="px-3 pt-1 pb-1.5 text-[11.5px] text-muted">管理者を切り替え（シミュレーション）</div>
          {ops.admins.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setOpen(false);
                if (a.id !== ops.currentAdminId) ops.loginAs(a.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
            >
              <span className="w-4 text-accent">{a.id === ops.currentAdminId && <Check size={14} />}</span>
              <span className="flex-1 truncate">{a.name}</span>
              <span className="text-[11.5px] text-muted">{ROLE_LABEL[a.role]}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <Link href="/settings/admins" onClick={() => setOpen(false)} className="block px-3 py-1.5 text-accent hover:bg-hover">
            管理者とロール
          </Link>
        </div>
      )}
    </div>
  );
}

/** 表示のみの権限で開いているときの表示 */
export function ViewOnlyBadge() {
  const canEdit = useCanEdit();
  if (canEdit) return null;
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded bg-warn/15 px-2 text-[12px] font-medium text-warn" title="この管理者は設定を変更できません。変更は適用されず、システムログに記録されます。">
      <Eye size={13} /> 表示のみ
    </span>
  );
}
