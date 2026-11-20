"use client";

import clsx from "clsx";
import { AlertTriangle, ChevronLeft, Info, Search, X, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { GLOSSARY } from "@/lib/glossary";
import type { Issue } from "@/lib/net/validate";

// --- レイアウト -------------------------------------------------------------

export function PageHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="mb-4 flex min-h-8 flex-wrap items-center gap-3">
      <h1 className="text-[15px] font-semibold">
        {title}
        {count !== undefined && <span className="ml-2 font-normal text-muted">{count}</span>}
      </h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={clsx("rounded-lg border border-line bg-surface", className)}>
      {title && (
        <header className="flex h-11 items-center justify-between px-4">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// --- 入力 -------------------------------------------------------------------

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
        variant === "secondary" && "border border-line bg-surface text-fg hover:bg-hover",
        variant === "ghost" && "text-accent hover:bg-accent-soft",
        variant === "danger" && "border border-line bg-surface text-err hover:bg-hover",
        className,
      )}
    />
  );
}

const inputCls =
  "h-8 w-full rounded border border-line bg-surface px-2.5 text-[13px] text-fg outline-none transition-colors placeholder:text-faint hover:border-faint focus:border-accent disabled:bg-surface-2 disabled:text-muted";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function Select({
  options,
  value,
  onChange,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <select aria-label={ariaLabel} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(inputCls, "pr-7", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({ value, onChange, placeholder = "検索" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-56">
      <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={clsx(inputCls, "pl-8")} />
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40", checked ? "bg-accent" : "bg-faint")}
    >
      <span className={clsx("absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-all", checked ? "left-3.5" : "left-0.5")} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-2 py-1", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className={clsx("inline-flex rounded border border-line bg-surface-2 p-0.5", size === "sm" ? "h-7" : "h-8")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-[3px] px-3 text-[12.5px] font-medium transition-colors",
            value === o.value ? "bg-surface text-fg shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string }[] }) {
  return (
    <div className="flex gap-5 border-b border-line px-5">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx("-mb-px h-10 border-b-2 text-[13px] font-medium transition-colors", value === t.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 縦積みのフォーム項目（サイドパネル用） */
export function Field({ label, term, children, hint, error }: { label: string; term?: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-[12px] text-muted">
        {label}
        {term && <Term id={term} />}
      </div>
      {children}
      {error ? <div className="mt-1 text-[12px] text-err">{error}</div> : hint ? <div className="mt-1 text-[12px] text-muted">{hint}</div> : null}
    </div>
  );
}

/** ラベル左・入力右のフォーム行（設定画面用） */
export function FormRow({ label, term, children, hint, error }: { label: string; term?: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 py-2.5 md:grid-cols-[220px_minmax(0,420px)] md:gap-6">
      <div className="flex items-center gap-1 text-fg-2 md:h-8">
        {label}
        {term && <Term id={term} />}
      </div>
      <div>
        {children}
        {error ? <div className="mt-1 text-[12px] text-err">{error}</div> : hint ? <div className="mt-1 text-[12px] text-muted">{hint}</div> : null}
      </div>
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line-soft py-4 last:border-0">
      <h3 className="mb-1 text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

// --- 表示 -------------------------------------------------------------------

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "ok" | "warn" | "err"; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center rounded px-1.5 text-[11.5px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-fg-2 ring-1 ring-line ring-inset",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "ok" && "text-ok",
        tone === "warn" && "text-warn",
        tone === "err" && "text-err",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Status({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx("size-2 shrink-0 rounded-full", ok ? "bg-ok" : "bg-err")} />
      <span className={ok ? "text-fg" : "text-err"}>{label ?? (ok ? "オンライン" : "オフライン")}</span>
    </span>
  );
}

/** VLAN の色（ポートマネージャー等で使う） */
const VLAN_COLORS = ["#006fff", "#8b5cf6", "#14b8a6", "#f59e0b", "#ec4899", "#22c55e", "#ef4444", "#0ea5e9"];
export function vlanColor(index: number) {
  return VLAN_COLORS[index % VLAN_COLORS.length];
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line-soft">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-muted">{k}</dt>
          <dd className="truncate text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 用語解説ツールチップ */
export function Term({ id }: { id: string }) {
  const g = GLOSSARY[id];
  if (!g) return null;
  return (
    <span className="group relative inline-flex align-middle" tabIndex={0}>
      <Info size={13} className="cursor-help text-faint group-hover:text-accent" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-72 -translate-x-1/2 rounded border border-line bg-surface p-3 text-left text-[12px] leading-relaxed font-normal text-fg shadow-lg group-hover:block group-focus:block">
        <span className="mb-0.5 block font-semibold">{g.term}</span>
        <span className="text-fg-2">{g.body}</span>
      </span>
    </span>
  );
}

export function IssueList({ issues, empty }: { issues: Issue[]; empty?: ReactNode }) {
  if (!issues.length) return empty ? <>{empty}</> : null;
  return (
    <ul className="divide-y divide-line-soft">
      {issues.map((i, k) => (
        <li key={k} className="flex gap-2.5 py-2.5">
          {i.severity === "error" ? <XCircle size={15} className="mt-px shrink-0 text-err" /> : <AlertTriangle size={15} className="mt-px shrink-0 text-warn" />}
          <div className="min-w-0">
            <div>{i.message}</div>
            {i.hint && <div className="mt-0.5 text-[12px] text-muted">{i.hint}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Notice({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  const err = issues.some((i) => i.severity === "error");
  return (
    <div className={clsx("mb-4 rounded border px-4 py-1", err ? "border-err/30 bg-err/5" : "border-warn/40 bg-warn/5")}>
      <IssueList issues={issues} />
    </div>
  );
}

// --- サイドパネル -------------------------------------------------------------

/** 画面右にドックするプロパティパネル（背景を暗くしない） */
export function SidePanel({
  open,
  onClose,
  icon,
  title,
  subtitle,
  children,
  footer,
  tabs,
}: {
  open: boolean;
  onClose: () => void;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tabs?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <aside className="fixed top-12 right-0 bottom-0 z-30 flex w-full max-w-[400px] flex-col border-l border-line bg-surface shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.15)]">
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          {subtitle && <div className="mt-0.5 text-[12px] text-muted">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-fg" aria-label="閉じる">
          <X size={16} />
        </button>
      </header>
      {tabs}
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <footer className="flex items-center gap-2 border-t border-line px-5 py-3">{footer}</footer>}
    </aside>
  );
}

export function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
      <ChevronLeft size={15} />
      {children}
    </button>
  );
}

/** フォームの下書き状態。Apply Changes で確定する UniFi 流の編集 */
export function useDraft<T>(source: T | undefined, key: string | undefined) {
  const [draft, setDraft] = useState<T | undefined>(source ? structuredClone(source) : undefined);
  useEffect(() => {
    setDraft(source ? structuredClone(source) : undefined);
    // key が変わったとき（別の対象を開いたとき）だけ読み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(source);
  const update = (fn: (d: T) => void) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const reset = () => setDraft(source ? structuredClone(source) : undefined);
  return { draft, update, dirty, reset };
}

export const table = {
  wrap: "overflow-x-auto rounded-lg border border-line bg-surface",
  table: "w-full text-left",
  th: "h-9 px-4 text-[12px] font-medium text-muted border-b border-line whitespace-nowrap",
  td: "h-11 px-4 border-b border-line-soft whitespace-nowrap",
  tr: "cursor-pointer transition-colors hover:bg-hover",
  sel: "bg-accent-soft hover:bg-accent-soft",
};
