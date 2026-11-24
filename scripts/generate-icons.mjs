#!/usr/bin/env node
/**
 * SciFlow 品牌图标生成器
 *
 * 单一事实源：docs/brand/icon-master.svg（1024×1024 矢量母版）
 * 产出：
 *   apps/desktop/build/icon.png        1024×1024（electron-builder 自动转 ico/icns）
 *   apps/desktop/build/icon-512.png    512×512（Linux/商店等场景）
 *   apps/web/public/apple-touch-icon.png  180×180（iOS 主屏）
 *   apps/web/public/icon-192.png          192×192（PWA）
 *   apps/web/public/icon-512.png          512×512（PWA）
 *   docs/brand/logo-mark-1024.png      独立标志位图（浅色底文档用）
 *
 * 依赖：@resvg/resvg-js（workspace devDependency，pnpm icons 自动安装于根）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const master = path.join(root, 'docs', 'brand', 'icon-master.svg');
const markSvg = path.join(root, 'docs', 'brand', 'logo-mark.svg');

async function main() {
  let Resvg;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch {
    console.error(
      '\x1b[31m[icons]\x1b[0m 缺少 @resvg/resvg-js，请先执行：\n' +
        '  pnpm add -D -w @resvg/resvg-js\n' +
        '然后重跑 pnpm icons',
    );
    process.exit(1);
  }

  const render = (svgPath, size, outPath) => {
    const svg = fs.readFileSync(svgPath, 'utf8');
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: undefined });
    const png = resvg.render().asPng();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, png);
    console.log(`\x1b[32m[icons]\x1b[0m ${path.relative(root, outPath)} (${size}×${size})`);
  };

  // 主图标（应用安装包用）
  render(master, 1024, path.join(root, 'apps', 'desktop', 'build', 'icon.png'));
  render(master, 512, path.join(root, 'apps', 'desktop', 'build', 'icon-512.png'));
  // Web / PWA / iOS
  render(master, 180, path.join(root, 'apps', 'web', 'public', 'apple-touch-icon.png'));
  render(master, 192, path.join(root, 'apps', 'web', 'public', 'icon-192.png'));
  render(master, 512, path.join(root, 'apps', 'web', 'public', 'icon-512.png'));
  // 品牌文档用独立标志位图
  render(markSvg, 1024, path.join(root, 'docs', 'brand', 'logo-mark-1024.png'));

  console.log('\x1b[32m[icons]\x1b[0m 全部图标已从矢量母版再生成（改品牌请改 icon-master.svg 后重跑 pnpm icons）');
}

main().catch((e) => {
  console.error('\x1b[31m[icons]\x1b[0m 失败:', e);
  process.exit(1);
});
