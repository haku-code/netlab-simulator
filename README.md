# NetLab

UniFi 風の管理画面で、ネットワーク設計（VLAN / サブネット / DHCP / Wi-Fi / ファイアウォール / トランク）を手を動かして学べるシミュレーター。すべてブラウザ内で動作し、状態は localStorage に保存されます。

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm test     # シミュレーターのテスト
```

## 構成
- `src/lib/net/simulate.ts` — 到達性シミュレーター（VLAN 判定 → DHCP/IP → L2 経路 BFS → ファイアウォール評価）
- `src/lib/net/validate.ts` — 設定の lint（サブネット重複、DHCP 範囲、評価されないルールなど）
- `src/lib/lessons/` — 学習課題（初期構成 + 合格条件 + ヒント）
- `src/lib/scenarios/` — サンドボックスの初期構成とビルダー
- `src/app/*` — 各画面（ダッシュボード / トポロジー / デバイス / クライアント / 診断 / 学習課題 / 設定）
