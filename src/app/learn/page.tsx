import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FirstConnectionLab } from "@/components/learning/FirstConnectionLab";
import { LearningHeader } from "@/components/learning/CourseLayout";
import { Card } from "@/components/ui";

export default function LearnPage() {
  return (
    <>
      <LearningHeader course="intro" />
      <div className="max-w-4xl space-y-4">
        <Card className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold">ゼロからのネットワーク入門</h2>
          <p className="mt-2 text-fg-2">
            スマホや PC は、ケーブルや Wi-Fi を使って家や教室の中でつながります。これが LAN です。
            インターネットは、その外にあるたくさんのネットワークのつながりです。ルーターは、家や教室の外へ通信を渡します。
          </p>
        </Card>
        <Card title="最初の実習 · PC から Web サイトを開く">
          <FirstConnectionLab />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/theory?unit=dhcp" className="group rounded-lg border border-line bg-surface p-4 hover:border-accent">
            <span className="flex items-center justify-between gap-2 font-semibold">アドレスが配られる仕組み <ArrowRight size={16} className="text-accent" /></span>
            <span className="mt-1 block text-[13px] text-fg-2">基礎理論の DHCP で、PC とルーターのやり取りを見ます。</span>
          </Link>
          <Link href="/lessons" className="group rounded-lg border border-line bg-surface p-4 hover:border-accent">
            <span className="flex items-center justify-between gap-2 font-semibold">「はじめての LAN」に挑戦 <ArrowRight size={16} className="text-accent" /></span>
            <span className="mt-1 block text-[13px] text-fg-2">実践コースで、PC とスマホの両方がつながるように設定を直します。</span>
          </Link>
        </div>
      </div>
    </>
  );
}
