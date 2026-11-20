"use client";

import { Terminal as TerminalIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useStore } from "@/lib/store";
import { runTerminalCommand, terminalCompletions, TERMINAL_ROUTES } from "@/lib/terminal";

interface Entry {
  command: string;
  lines: string[];
  error?: boolean;
}

const HISTORY_LIMIT = 100;

export function Terminal() {
  const router = useRouter();
  const titleId = useId();
  const helpId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef<number | null>(null);
  const draft = useRef("");
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const toggle = () => {
    const modal = dialog.current;
    if (!modal) return;
    if (modal.open) {
      modal.close();
    } else {
      modal.showModal();
      input.current?.focus();
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }
  };

  useEffect(() => {
    const handleShortcut = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;

      const isToggle = e.code === "KeyT";
      if (dialog.current?.open) {
        if (isToggle) {
          e.preventDefault();
          if (!e.repeat) toggle();
        }
        return;
      }
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest("input, textarea, select, [role='textbox']"))) return;
      const route = /^Digit[1-9]$/.test(e.code) ? TERMINAL_ROUTES[Number(e.code.slice(-1)) - 1] : undefined;
      const state = useStore.getState();
      const toggleLesson = e.code === "KeyL" && state.activeLessonId;
      if (!isToggle && !route && !toggleLesson) return;
      e.preventDefault();
      if (e.repeat) return;
      if (isToggle) toggle();
      else if (route) router.push(route.href);
      else state.setLessonPanelOpen(!state.lessonPanelOpen);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [router]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [entries]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = command.trim();
    if (!text) return;
    if (history.current.at(-1) !== text) history.current = [...history.current, text].slice(-HISTORY_LIMIT);
    historyIndex.current = null;
    draft.current = "";
    setCommand("");
    setSuggestions([]);

    const result = runTerminalCommand(text, useStore.getState());
    if (result.action === "clear") {
      setEntries([]);
      return;
    }
    setEntries((previous) => [...previous, { command: text, lines: result.lines, error: result.error }].slice(-HISTORY_LIMIT));
    if (result.action === "close" || result.href) dialog.current?.close();
    if (result.href) router.push(result.href);
  };

  const handleInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const index = historyIndex.current;
      const length = history.current.length;
      if (!length || (event.key === "ArrowDown" && index === null)) return;
      event.preventDefault();
      if (index === null) draft.current = command;
      const next = event.key === "ArrowUp" ? Math.max(0, (index ?? length) - 1) : (index ?? length) + 1;
      historyIndex.current = next === length ? null : next;
      setCommand(history.current[next] ?? draft.current);
      setSuggestions([]);
      return;
    }
    if (event.key !== "Tab" || event.shiftKey || !command.trim()) return;
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (selectionStart !== command.length || selectionEnd !== command.length) return;
    const { matches, prefix } = terminalCompletions(command, useStore.getState().scenario);
    if (matches.length === 0) return;
    if (matches.length === 1) {
      event.preventDefault();
      setCommand(command.slice(0, command.length - prefix.length) + matches[0] + " ");
      setSuggestions([]);
    } else if (suggestions.length === 0) {
      // A second Tab can move focus to the next control.
      event.preventDefault();
      setSuggestions(matches);
    }
  };

  const controlClass = "rounded p-1.5 text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="ターミナル"
        aria-haspopup="dialog"
        aria-keyshortcuts="Alt+Shift+T"
        title="ターミナル (Alt/Option + Shift + T)"
        className={controlClass}
      >
        <TerminalIcon size={17} strokeWidth={1.7} />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={helpId}
        onClose={() => setSuggestions([])}
        className="m-auto w-[min(48rem,calc(100%-1.5rem))] max-w-none overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-2xl backdrop:bg-black/45"
      >
        <div className="flex h-[min(33rem,calc(100dvh-1.5rem))] flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b border-line bg-chrome px-3 py-2">
            <TerminalIcon size={16} className="text-accent" />
            <h2 id={titleId} className="font-semibold">NetLab ターミナル</h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="ターミナルを閉じる" className={`ml-auto ${controlClass}`}>
              <X size={17} />
            </button>
          </header>
          <div
            ref={log}
            role="log"
            aria-label="コマンド出力"
            tabIndex={0}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-2 px-3 py-3 [font-family:ui-monospace,monospace] text-[13px] leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <p id={helpId} className="text-fg-2">
              <code>help</code> でコマンド一覧、<code>shortcuts</code> でショートカット一覧を表示します。
            </p>
            {entries.map((entry, i) => (
              <div key={i}>
                <div className="break-all font-semibold text-accent">netlab › {entry.command}</div>
                {entry.lines.length > 0 && (
                  <pre className={`font-[inherit] whitespace-pre-wrap [overflow-wrap:anywhere] ${entry.error ? "text-err" : "text-fg"}`}>
                    {entry.lines.join("\n")}
                  </pre>
                )}
              </div>
            ))}
          </div>
          {suggestions.length > 0 && (
            <p role="status" className="max-h-16 shrink-0 overflow-y-auto border-t border-line px-3 py-1 text-xs break-words text-fg-2">
              候補 · {suggestions.join(" · ")}
            </p>
          )}
          <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2 [font-family:ui-monospace,monospace]">
            <span aria-hidden="true" className="shrink-0 font-semibold text-accent">netlab ›</span>
            <input
              ref={input}
              aria-label="NetLab コマンド"
              type="text"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setSuggestions([]);
                historyIndex.current = null;
              }}
              onKeyDown={handleInputKey}
              placeholder="help"
              className="h-7 min-w-0 flex-1 rounded-sm px-1 text-[14px] outline-none focus-visible:ring-1 focus-visible:ring-accent"
            />
            <kbd aria-hidden="true" className="hidden shrink-0 rounded border border-line px-1.5 text-[11px] text-muted sm:inline">Enter</kbd>
          </form>
        </div>
      </dialog>
    </>
  );
}
