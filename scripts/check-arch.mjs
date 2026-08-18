/* eslint-disable */
/**
 * 架构依赖守卫（docs/ARCHITECTURE.md §6 的机制化执行）。
 * 用法：node scripts/check-arch.mjs
 *
 * 规则：
 *  1. lib 不得 import hooks / components
 *  2. hooks 禁止跨领域依赖（白名单除外）；hooks 不得 import components
 *  3. 同层 UI 区块禁止互相依赖（区块清单见 BLOCKS）
 *  5. stage 不得接触 accounts（由 2 + 区块规则覆盖）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');

/** 跨领域 hook 依赖白名单：key = 源领域目录名，value = 允许依赖的领域目录名。 */
const HOOK_WHITELIST = {
  // 例：'playlist': ['library']
};

/** 顶层视图区块（同层互不依赖）。 */
const BLOCKS = [
  'components/BackgroundLayer.tsx',
  'components/LyricsLayer.tsx',
  'components/StageCanvas.tsx',
  'components/BottomBar.tsx',
  'components/TopBar.tsx',
  'components/AccountDock.tsx',
  'components/PlaylistDock.tsx',
  'components/OverlayStack.tsx',
];

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  const re = /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function resolveTarget(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // 裸导入（node_modules）忽略
  let p = resolve(dirname(fromFile), spec);
  // 无扩展名导入（项目惯例）：补全 .tsx / .ts，使规则能命中 BLOCKS 清单
  if (!/\.[a-zA-Z]+$/.test(p)) {
    if (existsSync(p + '.tsx')) p += '.tsx';
    else if (existsSync(p + '.ts')) p += '.ts';
  }
  const rel = relative(SRC, p).split(sep).join('/');
  return rel;
}

const errors = [];

for (const file of listFiles(SRC)) {
  const rel = relative(SRC, file).split(sep).join('/');
  const inLib = rel.startsWith('lib/');
  const inHooks = rel.startsWith('hooks/');
  const hookDomain = inHooks ? rel.split('/')[1] : null;
  const isBlock = BLOCKS.includes(rel);

  for (const spec of importsOf(file)) {
    const target = resolveTarget(file, spec);
    if (!target) continue;
    const tInHooks = target.startsWith('hooks/');
    const tInComponents = target.startsWith('components/');

    // 规则 1：lib 不得 import hooks / components
    if (inLib && (tInHooks || tInComponents)) {
      errors.push(`${rel} → ${target}：lib 不得 import hooks/components`);
    }
    // 规则 2：hooks 不得 import components；跨领域需白名单
    if (inHooks) {
      if (tInComponents) {
        errors.push(`${rel} → ${target}：hooks 不得 import components`);
      }
      if (tInHooks) {
        const tDomain = target.split('/')[1];
        if (tDomain !== hookDomain && !(HOOK_WHITELIST[hookDomain] || []).includes(tDomain)) {
          errors.push(`${rel} → ${target}：跨领域 hook 依赖未在白名单（${hookDomain} → ${tDomain}）`);
        }
      }
    }
    // 规则 3：同层 UI 区块互不依赖
    if (isBlock && BLOCKS.includes(target)) {
      errors.push(`${rel} → ${target}：同层 UI 区块禁止互相依赖，组合只由 App 完成`);
    }
  }
}

if (errors.length) {
  console.error('[check-arch] 依赖违规：');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('[check-arch] 通过 ✔');
