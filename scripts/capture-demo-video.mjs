/**
 * 真实操作演示视频录制（供 README / docs/media/demo.mp4 使用）
 * 前置：mock 后端 :3000 + web dev :5173 已启动，且演示项目已由 scripts/seed-demo.mjs 种好。
 * 用法：node scripts/capture-demo-video.mjs && ffmpeg 压缩（见脚本尾部提示）
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const BASE = process.env.SHOT_BASE || 'http://localhost:5173';
const API = process.env.SHOT_API || 'http://127.0.0.1:3000';
const OUT = path.resolve('docs/media');
const TMP = path.resolve('.video-tmp');

async function pickDocId() {
  try {
    const res = await fetch(`${API}/api/projects`);
    const projects = await res.json();
    if (!projects.length) return null;
    const r2 = await fetch(`${API}/api/documents?projectId=${projects[0].id}&scope=project`);
    const docs = await r2.json();
    const list = Array.isArray(docs) ? docs : docs.items || [];
    const best = [...list].sort((a, b) => (b.content || '').length - (a.content || '').length)[0];
    return best?.id || null;
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const docId = await pickDocId();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: TMP, size: { width: 1600, height: 1000 } },
  });
  const page = await context.newPage();
  const wait = (ms) => page.waitForTimeout(ms);
  const go = async (hash, ms = 2200) => {
    await page.goto(`${BASE}/${docId && hash.startsWith('#/workspace') ? `${hash}?doc=${docId}` : hash}`, { waitUntil: 'networkidle' });
    await wait(ms);
  };

  // 分镜：工作台 → 流水线（深度/时间线）→ 质量 → 写作 → 文献 → 知识库 → 实验 → 总览 → 深色
  await go('#/workspace', 3200);
  await go('#/pipeline', 3000);
  await go('#/quality', 2600);
  await go('#/writing', 3000);
  await go('#/literature', 2400);
  await go('#/knowledge', 2200);
  await go('#/experiments', 2600);
  await go('#/dashboard', 2400);
  await page.emulateMedia({ colorScheme: 'dark' });
  await go('#/settings', 2400);

  await context.close();
  await browser.close();

  const videos = fs.readdirSync(TMP).filter((f) => f.endsWith('.webm'));
  if (!videos.length) throw new Error('录制失败：未产出 webm');
  const raw = path.join(TMP, videos[0]);
  const mp4 = path.join(OUT, 'demo.mp4');
  execSync(`ffmpeg -y -i "${raw}" -c:v libx264 -crf 26 -preset medium -movflags +faststart "${mp4}"`, { stdio: 'pipe' });
  const kb = (fs.statSync(mp4).size / 1024).toFixed(0);
  console.log(`OK docs/media/demo.mp4 (${kb} KB)`);
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
