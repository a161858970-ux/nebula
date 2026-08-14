/* 桌面版环境自检：运行 `node scripts/desktop-check.mjs`（pnpm desktop 会自动调用） */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const problems = [];

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
if (pkg.main !== 'electron/main.cjs') {
  problems.push('package.json 缺少 "main": "electron/main.cjs"');
}
if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
  problems.push('缺少 dist/index.html —— 请先运行 pnpm build:desktop');
}
if (!fs.existsSync(path.join(root, 'dist-main/index.cjs'))) {
  problems.push('缺少 dist-main/index.cjs —— 请先运行 pnpm build:main');
}
try {
  require.resolve('electron');
} catch {
  problems.push('未安装 electron —— 请先运行 npm i -D electron（国内网络见 README 镜像配置）');
}

if (problems.length) {
  console.error('桌面版环境检查未通过：');
  problems.forEach((p) => console.error('  ✘ ' + p));
  console.error('\n修复后重试：pnpm desktop');
  process.exit(1);
}

console.log('桌面版环境检查通过 ✔ 正在启动 Electron…');
