"use client";

import Link from "next/link";
import { Segmented } from "../ui";

export function CourseTabs({ value }: { value: "practice" | "theory" }) {
  return (
    <Segmented
      value={value}
      onChange={() => {}}
      options={[
        { value: "practice", label: <Link href="/lessons">実践コース</Link> },
        { value: "theory", label: <Link href="/theory">基礎理論コース</Link> },
      ]}
    />
  );
}
