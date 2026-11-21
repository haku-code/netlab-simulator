import clsx from "clsx";
import Link from "next/link";

const COURSES = [
  { id: "intro", label: "ゼロからの入門", href: "/learn" },
  { id: "theory", label: "基礎理論コース", href: "/theory" },
  { id: "practice", label: "実践コース", href: "/lessons" },
  { id: "glossary", label: "用語・規格", href: "/learn/glossary" },
] as const;

export function CourseTabs({ value }: { value: (typeof COURSES)[number]["id"] }) {
  return (
    <nav aria-label="学習コース" className="flex flex-wrap gap-1 rounded-md bg-surface-2 p-1">
      {COURSES.map((course) => (
        <Link key={course.id} href={course.href} aria-current={value === course.id ? "page" : undefined}
          className={clsx("rounded px-2.5 py-1 text-[12.5px] font-medium", value === course.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
          {course.label}
        </Link>
      ))}
    </nav>
  );
}
