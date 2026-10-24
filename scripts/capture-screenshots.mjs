/**
 * 真实界面截图采集（供 README / 文档使用）
 * 前置：mock 后端 :3300 + web dev :5173 已启动，且目标项目已有流水线产物。
 * 用法：node scripts/capture-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:5173';
const API = process.env.SHOT_API || 'http://127.0.0.1:3000';
const OUT = path.resolve('docs/screenshots');
const W = 1600;
const H = 1000;

const shots = [
  { name: 'workspace.png', hash: '#/workspace', wait: 2500, label: '对话工作台' },
  { name: 'pipeline.png', hash: '#/pipeline', wait: 2000, label: '流水线编排' },
  { name: 'quality.png', hash: '#/quality', wait: 2500, label: '质量评分' },
  { name: 'literature.png', hash: '#/literature', wait: 2000, label: '文献库' },
  { name: 'knowledge.png', hash: '#/knowledge', wait: 1500, label: '知识库 RAG' },
  { name: 'dash.png', hash: '#/dashboard', wait: 2500, label: '项目总览' },
  { name: 'experiments.png', hash: '#/experiments', wait: 2000, label: '实验沙箱与设计助手' },
  { name: 'submission.png', hash: '#/submission', wait: 2000, label: '投稿辅助' },
  { name: 'memory.png', hash: '#/memory', wait: 1500, label: '记忆中心' },
  { name: 'settings.png', hash: '#/settings', wait: 2000, label: '设置' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // 取最新文档用于写作页深链
  let docId = null;
  try {
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (projects.length) {
      const r2 = await fetch(`${API}/api/documents?projectId=${projects[0].id}&scope=project`);
      const docs = await r2.json();
      const list = Array.isArray(docs) ? docs : docs.items || [];
      // 选择正文最长的文档：列表首项常是回归脚本产生的空壳文档，截图会得到空白预览
      const best = [...list].sort((a, b) => (b.content || '').length - (a.content || '').length)[0];
      if (best) docId = best.id || best.documentId;
    }
  } catch (e) {
    console.warn('doc lookup skipped:', e.message);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  let currentShot = '(boot)';
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [console.error @ ${currentShot}]`, m.text().slice(0, 500).split('\n').join(' | '));
  });

  // 关掉可能遮挡的 toast/弹窗：先加载一次让本地存储就绪
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  for (const s of shots) {
    currentShot = s.name;
    // 工作台/写作页支持 ?doc= 深链：优先展示有正文的文档，避免截到回归产生的空壳文档
    const hash = s.hash === '#/workspace' && docId ? `#/workspace?doc=${docId}` : s.hash;
    const url = `${BASE}/${hash}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(s.wait);
    const file = path.join(OUT, s.name);
    await page.screenshot({ path: file, fullPage: false });
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    console.log(`OK  ${s.name.padEnd(18)} ${s.label}  (${kb} KB)`);
  }

  // 深色主题（跟随系统态）：settings-dark.png
  currentShot = 'settings-dark.png';
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, 'settings-dark.png'), fullPage: false });
  console.log(`OK  settings-dark.png   深色主题 (${(fs.statSync(path.join(OUT, 'settings-dark.png')).size / 1024).toFixed(0)} KB)`);
  await page.emulateMedia({ colorScheme: 'light' });

  if (docId) {
    currentShot = 'writing.png';
    await page.goto(`${BASE}/#/writing?doc=${docId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const file = path.join(OUT, 'writing.png');
    await page.screenshot({ path: file, fullPage: false });
    console.log(`OK  writing.png        长文写作 (${(fs.statSync(file).size / 1024).toFixed(0)} KB) doc=${docId}`);
  } else {
    console.warn('未找到文档，writing.png 跳过');
  }

  await browser.close();
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
