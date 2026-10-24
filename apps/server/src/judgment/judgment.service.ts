import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { db } from '../db/database';
import { appSettings, customIntents } from '../db/schema';
import { parseStringList } from '../common/json-guard';
import { eq } from 'drizzle-orm';

/**
 * 判断层（Judgment Layer）——对标 Jev System One Model
 * 高频判断不每次调用昂贵生成式 LLM：本地规则表快速命中（毫秒级、零成本），
 * 未命中才走 LLM 结构化输出（zod 校验）。
 * provider 可插拔：配置 JUDGMENT_BASE_URL / JUDGMENT_API_KEY 后自动切换到 Jev 类判别器 API。
 */

interface IntentResult {
  intent: string;
  label: string;
  confidence: number;
  topic: string;
  route: string;
  matchedBy: 'rule' | 'llm';
}

const INTENTS: { key: string; label: string; route: string; keywords: string[] }[] = [
  { key: 'search_literature', label: '检索文献', route: '/literature', keywords: ['查文献', '搜文献', '检索', '找论文', '找文献', '搜索文献', '查一下文献', '相关文献'] },
  { key: 'summarize', label: '文献综述', route: '/literature', keywords: ['综述', '总结文献', '文献总结', '梳理文献', 'literature review', 'survey'] },
  { key: 'extract', label: '结构化提取', route: '/literature', keywords: ['结构化提取', '提取文献', '对比表', '方法对比'] },
  { key: 'evidence', label: '证据综合', route: '/literature', keywords: ['证据', '共识', '综合证据', '支持还是矛盾', '观点是否一致'] },
  { key: 'deepdive', label: '单篇精读', route: '/literature', keywords: ['精读', '深读', '深度解读', '解剖', '拆解这篇', '读这篇'] },
  { key: 'gap', label: '研究缺口', route: '/literature', keywords: ['缺口', '研究空白', '选题', '还能做什么', 'research gap', '创新点'] },
  { key: 'compare', label: '文献对比', route: '/literature', keywords: ['对比', '比较', '哪篇更好', '异同', '差异', '区别'] },
  { key: 'outline', label: '生成大纲', route: '/writing', keywords: ['大纲', '提纲', '框架', '结构', '章节安排', 'outline'] },
  { key: 'draft', label: '章节起草', route: '/writing', keywords: ['起草', '写章节', '写正文', '写一段', '开始写', '初稿', '撰写'] },
  { key: 'polish', label: '润色降重', route: '/writing', keywords: ['润色', '降重', '改写', '修饰', '精修', 'polish', '语言表达'] },
  { key: 'translate', label: '学术翻译', route: '/writing', keywords: ['翻译', '英文怎么说', '译成', 'translate', '中译英', '英译中'] },
  { key: 'abstract', label: '摘要关键词', route: '/writing', keywords: ['摘要', '关键词', 'abstract', '提炼'] },
  { key: 'design_review', label: '研究设计诊断', route: '/writing', keywords: ['设计诊断', '可行性', '新颖性', '研究想法', '值得做吗', '评估想法', '想法诊断'] },
  { key: 'review', label: '模拟同行评审', route: '/writing', keywords: ['评审', '审稿', '模拟审稿', '会不会被拒', 'peer review', '审稿人'] },
  { key: 'pipeline', label: '全自动流水线', route: '/pipeline', keywords: ['流水线', '全自动', '一键生成论文', '跑流程', '自动写', '启动任务'] },
  { key: 'quality', label: '质量评分', route: '/quality', keywords: ['评分', '质量', '打几分', '哪里有问题', '缺陷', '7维'] },
  { key: 'qa', label: '科研问答', route: '/chat', keywords: ['什么是', '解释', '原理', '为什么', '机制', '概念', '讲一下', '科普'] },
];

@Injectable()
export class JudgmentService {
  constructor(private readonly ai: AiService) {}

  /** 意图判断模式（用户可配置）：auto/rule_first=规则优先+LLM兜底，llm_first=LLM优先规则兜底，rule_only=仅规则 */
  private mode(): string {
    try {
      return db.select().from(appSettings).where(eq(appSettings.key, 'judgment_mode')).get()?.value ?? 'auto';
    } catch {
      return 'auto';
    }
  }

  /** 合并意图库：系统默认（只读）+ 数据库自定义（用户可增删改启停） */
  private mergedIntents(): { key: string; label: string; route: string; keywords: string[] }[] {
    const merged = [...INTENTS];
    try {
      const rows = db.select().from(customIntents).where(eq(customIntents.enabled, 1)).all();
      for (const r of rows) {
        const kw = parseStringList(r.keywords);
        const idx = merged.findIndex((i) => i.key === r.key);
        if (idx >= 0) {
          merged[idx] = { key: r.key, label: r.label, route: r.route, keywords: kw };
        } else {
          merged.push({ key: r.key, label: r.label, route: r.route, keywords: kw });
        }
      }
    } catch {
      /* 数据库不可用时回退系统默认 */
    }
    return merged;
  }

  /** 规则快速命中：关键词扫描（Jev 式 System One，零成本毫秒级） */
  private ruleMatch(text: string): { key: string; matched: string[] } | null {
    // 去空格小写归一（'meta 分析' 与 'meta分析' 等价）
    const t = text.toLowerCase().replace(/\s+/g, '');
    const intents = this.mergedIntents(); // 只查一次库（循环外，避免 N+1）
    let best: { key: string; matched: string[] } | null = null;
    for (const it of intents) {
      const hit = it.keywords.filter((k) => t.includes(k.toLowerCase().replace(/\s+/g, '')));
      if (hit.length > 0 && (!best || hit.length > best.matched.length)) {
        best = { key: it.key, matched: hit };
      }
    }
    return best;
  }

  /** 意图识别：规则优先 → LLM 兜底（zod 校验）；provider 可切 Jev 判别器 */
  async intent(text: string, context: string = ''): Promise<IntentResult> {
    const mode = this.mode();
    const rule = this.ruleMatch(text);
    // rule_only：只走规则，未命中即通用问答（零成本，适合高频稳定场景）
    if (mode === 'rule_only') {
      if (rule) {
        const it = this.mergedIntents().find((i) => i.key === rule.key)!;
        return {
          intent: it.key,
          label: it.label,
          confidence: Math.round(Math.min(0.6 + rule.matched.length * 0.15, 0.95) * 100) / 100,
          topic: this.extractTopic(text),
          route: it.route,
          matchedBy: 'rule',
        };
      }
      return { intent: 'qa', label: '科研问答', confidence: 0.5, topic: this.extractTopic(text), route: '/chat', matchedBy: 'rule' };
    }
    // llm_first：LLM 优先，失败降级规则
    if (mode === 'llm_first') {
      const llm = await this.llmJudgment(text, context);
      if (llm) return llm;
      if (rule) {
        const it = this.mergedIntents().find((i) => i.key === rule.key)!;
        return {
          intent: it.key,
          label: it.label,
          confidence: Math.round(Math.min(0.6 + rule.matched.length * 0.15, 0.95) * 100) / 100,
          topic: this.extractTopic(text),
          route: it.route,
          matchedBy: 'rule',
        };
      }
      return { intent: 'qa', label: '科研问答', confidence: 0.5, topic: this.extractTopic(text), route: '/chat', matchedBy: 'llm' };
    }
    // auto / rule_first（默认）：规则优先，LLM 兜底
    if (rule) {
      const it = this.mergedIntents().find((i) => i.key === rule.key)!;
      return {
        intent: it.key,
        label: it.label,
        confidence: Math.round(Math.min(0.6 + rule.matched.length * 0.15, 0.95) * 100) / 100,
        topic: this.extractTopic(text),
        route: it.route,
        matchedBy: 'rule',
      };
    }
    const llm = await this.llmJudgment(text, context);
    if (llm) return llm;
    return { intent: 'qa', label: '科研问答', confidence: 0.5, topic: this.extractTopic(text), route: '/chat', matchedBy: 'llm' };
  }

  /**
   * LLM 判别兜底（结构化输出 + zod 校验）。
   *
   * provider 可插拔：设置 JUDGMENT_BASE_URL + JUDGMENT_API_KEY（+ 可选 JUDGMENT_MODEL）
   * 后，判别请求改发到该 OpenAI 兼容端点（Jev 类判别器 / 本地小模型），
   * 与生成模型解耦——高频判断不再消耗昂贵生成配额；任一项缺失则沿用主 AI 服务。
   */
  private async llmJudgment(text: string, context: string = ''): Promise<IntentResult | null> {
    // LLM 兜底（结构化输出 + zod 校验）
    try {
      const schema = z.object({
        intent: z.string(),
        confidence: z.number().min(0).max(1),
        topic: z.string(),
      });
      const candidates = this.mergedIntents().map((i) => `${i.key}(${i.label})`).join('、');
      const prompt = `你是科研助手的意图判别器。用户消息：${text}${context ? `\n项目上下文：${context}` : ''}
请判断用户想执行哪个科研动作，只允许从以下候选中选择一个：${candidates}。
要求：
- 用户只是提问/闲聊时选 qa；无法判断时选 other
- 输出 JSON：{"intent":"候选key","confidence":0.0-1.0,"topic":"从消息中提取的研究主题（无则空字符串）"}
只输出 JSON，不要其他文字。`;
      const raw = await this.completeJudgment(prompt);
      const parsed = this.ai.safeParse(raw, schema);
      if (parsed) {
        const it = this.mergedIntents().find((i) => i.key === parsed.intent);
        if (it) {
          return {
            intent: it.key,
            label: it.label,
            confidence: parsed.confidence,
            topic: parsed.topic || '',
            route: it.route,
            matchedBy: 'llm',
          };
        }
      }
    } catch {
      /* LLM 不可用时降级为通用问答 */
    }
    return { intent: 'qa', label: '科研问答', confidence: 0.5, topic: '', route: '/chat', matchedBy: 'llm' };
  }

  /**
   * 判别器调用：配置了 JUDGMENT_BASE_URL + JUDGMENT_API_KEY 则走独立端点，
   * 否则回落到主 AI 服务（保持历史行为不变）。
   */
  private async completeJudgment(prompt: string): Promise<string> {
    const baseUrl = (process.env.JUDGMENT_BASE_URL || '').replace(/\/$/, '');
    const apiKey = process.env.JUDGMENT_API_KEY || '';
    if (!baseUrl || !apiKey) {
      return this.ai.complete([{ role: 'user', content: prompt }], { temperature: 0, context: 'judgmentIntent' });
    }
    const model = process.env.JUDGMENT_MODEL || 'judgment';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
      signal: AbortSignal.timeout(Number(process.env.JUDGMENT_TIMEOUT_MS) || 15_000),
    });
    if (!res.ok) throw new Error(`判别器 HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return String(data.choices?.[0]?.message?.content || '').trim();
  }

  private extractTopic(text: string): string {
    // 简单抽取：去掉常见动作词后取首句
    const cleaned = text
      .replace(/^(帮我|请|麻烦|能不能|可以|想请你|我需要你)/, '')
      .replace(/^(对比|比较|精读|综述|检索|搜索|找|查|润色|翻译|起草|生成|写|评分|分析|解释|介绍)(?:一下|一遍|一遍)*/, '')
      .trim();
    return cleaned.split(/[，。？！,?!；;]/)[0].slice(0, 40) || '';
  }

}
