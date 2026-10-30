// 性能確認: ビルドして preview を起動する。ブラウザで開くと 5 秒ごとに
// "[flytown:perf] fps=... avg_ms=... p95_ms=... draws=... tris=..." がコンソールに出る。
// ヘッドレスブラウザは使わない（依存を増やさないため）。
import { spawnSync, spawn } from 'node:child_process';

const b = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (b.status !== 0) process.exit(b.status ?? 1);
console.log('\n[check:perf] http://localhost:4173/flytown/ を開き、コンソールの [flytown:perf] 行を読んでください。');
console.log('[check:perf] 目標: ハエ人 4 + NPC 20 + 車 15 で 60 fps 近辺（M1 / Chrome）。window.__flytown.perf でも値を読めます。\n');
spawn('npx', ['vite', 'preview', '--port', '4173', '--host'], { stdio: 'inherit' });
