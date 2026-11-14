/**
 * 长篇一致性检查（确定性，不调模型）。
 *
 * 为什么需要：跨章一致目前只靠「摘要 + 提示词约束」，模型仍会改名、换称呼、丢人物。
 * 这类错误不能靠再问一次模型判断（同一模型会认为自己的输出一致），必须用确定性规则比对。
 *
 * 三类检查：
 *  1. 实体漂移：章节计划里声明的出场实体，正文里必须出现（少了 = 漏写）。
 *  2. 未登记实体：正文里出现的「疑似人名」如果不在全书实体表里，提示可能是另起名字。
 *  3. 称呼不一致：同一实体在全书出现多种写法（如「陈默」与「陈墨」）时报警。
 */

/** 中文姓名常见姓氏（用于「疑似人名」识别，宁可少报不误报） */
const CN_SURNAMES = new Set(
  ('王李张刘陈杨黄赵周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方邹熊白孟秦邱侯江尹薛闫段雷黎史陶毛郝顾龚邵万钱严覃武戴莫孔向汤').split(''),
);

/**
 * 非人名的常见「姓氏 + 汉字」组合（地名/物件/动作）。
 * 不做这层过滤时，「档案」「陈述」「周边」都会被当成疑似人名，产生大量 info 噪音，
 * 让真正的改名问题淹没在几十条误报里。
 */
const CN_FALSE_POSITIVES = new Set([
  '档案', '陈述', '陈列', '周边', '周末', '黄色', '黄金', '高处', '高级', '高兴', '白色', '白天',
  '方向', '方式', '方法', '于是', '余地', '叶子', '程度', '程度', '江苏', '江湖', '江南', '毛病',
  '石头', '石头', '万一', '严肃', '武力', '戴', '曾经', '曾经', '任何', '任务', '何况', '何况',
  '林子', '罗列', '梁上', '宋代', '唐突', '许多', '韩', '冯', '邓', '曹', '彭', '萧', '田里',
  '董事', '袁', '潘', '于', '蒋', '蔡', '余下', '杜', '叶', '苏醒', '魏', '吕', '丁', '沈阳',
  '姚', '卢', '姜', '崔', '钟', '谭', '陆续', '汪', '范', '金', '石', '廖', '贾', '夏', '韦',
  '付', '方', '邹', '熊', '白', '孟', '秦', '邱', '侯', '江', '尹', '薛', '闫', '段', '雷',
  '黎明', '史', '陶', '毛', '郝', '顾', '龚', '邵', '万', '钱', '严', '覃', '武', '戴', '莫',
  '孔', '向', '汤',
]);

/** 中文姓名猜测：姓 + 1-2 个汉字，且不是常见词（保守过滤） */
const CN_STOP = new Set(['主角', '他了', '她的', '我们', '他们', '你们', '什么', '这个', '那个', '自己', '已经', '还是', '就是', '因为', '所以', '但是', '如果', '时候', '现在', '这里', '那里', '一个', '没有', '可以', '知道', '觉得', '看着', '听见', '突然', '然后', '于是', '只是', '而是', '不是']);

/**
 * 中文姓名猜测：按「姓氏位置」扫描，而不是正则整段贪婪匹配。
 *
 * 历史 bug：`/[\u4e00-\u9fa5]{2,3}/g` 对「陈墨抬起头」会贪婪吃成「陈墨抬」，
 * 导致真正的「陈墨」永远匹配不到；对「档案室」又会吃成「档案室」，把普通词当人名。
 * 现在：遇到姓氏字就分别取 2 字与 3 字候选，交给调用方与已登记实体比对。
 */
export function guessChineseNames(text: string, known: Set<string> = new Set()): string[] {
  const s = String(text || '');
  const out = new Set<string>();
  for (let i = 0; i < s.length; i++) {
    if (!CN_SURNAMES.has(s[i])) continue;
    // 2 字候选：姓氏 + 1 字，最常见的姓名长度
    const two = s.slice(i, i + 2);
    if (two.length === 2 && !CN_STOP.has(two) && !CN_FALSE_POSITIVES.has(two)) out.add(two);
    // 3 字候选只在「整串就是已登记实体」时采纳：否则「陈默走」「陈默打」都会被当成人名
    const three = s.slice(i, i + 3);
    if (three.length === 3 && known.has(three)) out.add(three);
  }
  return [...out];
}

export interface ConsistencyChapter {
  seq: number;
  title: string;
  entities: string[];
  content: string;
}

export interface ConsistencyIssue {
  kind: 'missing-entity' | 'unregistered-entity' | 'name-variant';
  severity: 'warning' | 'info';
  seq?: number;
  title?: string;
  message: string;
}

export interface ConsistencyReport {
  chapters: number;
  chars: number;
  declaredEntities: string[];
  observedEntities: string[];
  issues: ConsistencyIssue[];
  /** 0-100：按问题数量与严重度扣分，用于快速判断「这一版是否退步」 */
  score: number;
}

/**
 * 检查全书一致性。
 * @param chapters 已完成章节（含声明的 entities 与正文）
 * @param knownEntities 全书登记实体（可来自设定表；为空时用章节声明合并）
 */
export function checkConsistency(chapters: ConsistencyChapter[], knownEntities: string[] = []): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  const declared = new Set<string>(knownEntities.filter(Boolean));
  for (const ch of chapters) for (const e of ch.entities) if (e) declared.add(e);

  const observed = new Set<string>();
  for (const ch of chapters) {
    const body = ch.content || '';
    // 1) 声明了但正文没出现
    for (const e of ch.entities) {
      if (!e) continue;
      if (!body.includes(e)) {
        issues.push({
          kind: 'missing-entity',
          severity: 'warning',
          seq: ch.seq,
          title: ch.title,
          message: `第 ${ch.seq} 章声明出场「${e}」，但正文未出现`,
        });
      }
    }
    // 2) 正文里疑似人名但未登记
    for (const name of guessChineseNames(body, declared)) {
      observed.add(name);
      if (declared.has(name)) continue;
      // 与已登记实体共享首字（常见改名：陈默→陈墨）优先按「变体」报
      const variantOf = [...declared].find((d) => d.length === name.length && d[0] === name[0] && d !== name);
      issues.push({
        kind: variantOf ? 'name-variant' : 'unregistered-entity',
        severity: variantOf ? 'warning' : 'info',
        seq: ch.seq,
        title: ch.title,
        message: variantOf
          ? `第 ${ch.seq} 章出现「${name}」，与已登记「${variantOf}」仅一字之差，疑似改名`
          : `第 ${ch.seq} 章出现未登记人名「${name}」`,
      });
    }
  }

  // 去重（同名问题只报一次）
  const seen = new Set<string>();
  const deduped = issues.filter((i) => {
    const k = `${i.kind}:${i.seq}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const warnings = deduped.filter((i) => i.severity === 'warning').length;
  const infos = deduped.length - warnings;
  const score = Math.max(0, 100 - warnings * 8 - infos * 2);

  return {
    chapters: chapters.length,
    chars: chapters.reduce((s, c) => s + (c.content || '').length, 0),
    declaredEntities: [...declared].sort(),
    observedEntities: [...observed].sort(),
    issues: deduped.slice(0, 200),
    score,
  };
}
