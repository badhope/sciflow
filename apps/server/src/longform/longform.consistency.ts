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
    const two = s.slice(i, i + 2);
    if (two.length !== 2) continue;
    if (CN_STOP.has(two) || CN_FALSE_POSITIVES.has(two)) continue;
    // 已登记实体直接收（不受下面的启发式限制）
    if (known.has(two)) {
      out.add(two);
      continue;
    }
    // 未登记候选：满足任一才收
    //  a) 第二字是常见人名用字；
    //  b) 与某个已登记实体同姓同长度（改名检测的关键场景：陈默 → 陈墨，墨不在白名单里）。
    // 其余一律丢弃：否则「白墙/钟表/史状」这类普通词会被当成人名，几十条噪音会埋掉真问题。
    const sameSurnameEntity = [...known].some((k) => k.length === 2 && k[0] === two[0] && k !== two);
    if (!CN_GIVEN_CHARS.has(two[1]) && !sameSurnameEntity) continue;
    out.add(two);
    // 3 字候选只在整串是已登记实体时采纳（避免「陈默走」）
    const three = s.slice(i, i + 3);
    if (three.length === 3 && known.has(three)) out.add(three);
  }
  return [...out];
}

/**
 * 常见人名用字（第二字白名单）。
 * 不做这层限制时，「白墙」「钟表」「史状」「钟而」都会被识别成人名，
 * 一本书能刷出几十条误报，把真正的问题埋掉。
 */
const CN_GIVEN_CHARS = new Set(
  ('伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂香文华建国志强晓东海燕鹏飞宇浩然子轩雨欣佳怡梓涵一诺思远若曦晨阳雨泽沐辰逸辰清越知微怀瑾致远思齐南星北辰衡之').split(''),
);

/**
 * 实体名归一化：模型常把实体写成「名称（角色）」，如「林远（主角/测绘员）」。
 * 正文里只会出现「林远」，拿带括号的整串去比对必然 0 命中——这是检查器与数据格式的契约差异，
 * 不是正文漏写。这里统一剥掉括号注释，再参与比对与展示。
 */
export function normalizeEntityName(raw: string): string {
  const s = String(raw || '').trim();
  // 1) 去掉括号注释：「林远（主角/测绘员）」→「林远」
  const cut = s.replace(/[（(][^）)]*[）)]/g, '').trim() || s;
  // 2) 去掉角色前缀：「向导阿海」→「阿海」、「主角林远」→「林远」
  //    只剥已知角色词，避免把正常地名（如「老城区」）误切。
  const m = /^(主角|配角|反派|向导|旁白|叙述者|NPC|npc|地点|地标|目标|线索|文档|信息|方案|威胁|事件|环境|实体|人物|组织|系统|模块|设备|区域)(.+)$/.exec(cut);
  if (m && m[2].length >= 2) return m[2].trim();
  return cut;
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
  const declared = new Set<string>();
  for (const e of knownEntities) {
    const n = normalizeEntityName(e);
    if (n) declared.add(n);
  }
  for (const ch of chapters) {
    for (const e of ch.entities) {
      const n = normalizeEntityName(e);
      if (n) declared.add(n);
    }
  }

  const observed = new Set<string>();
  for (const ch of chapters) {
    const body = ch.content || '';
    // 1) 声明了但正文没出现（按归一化名比对）
    for (const raw of ch.entities) {
      const e = normalizeEntityName(raw);
      if (!e) continue;
      if (!body.includes(e)) {
        /**
         * 分级：只有「人/地点」类漏写才扣分。
         * 实测一本书会声明 40+ 个设备/文档/参数类实体（全站仪、历史档案、加密指令…），
         * 正文没逐字提到它们是正常写作取舍，不该和「主角没出场」同权重报警，
         * 否则分数恒为 0，真正的人物漏写被淹没。
         */
        /**
         * 判定标准（保守）：只有「2-3 个纯汉字、看起来就是人名」的实体才算 critical。
         * 「无线电通讯 / 灯塔内部人员 / 新挖掘土壤 / 浑浊海水」这类描述性名词一律 info——
         * 它们没在正文里逐字出现是正常写作取舍，不该压掉分数。
         */
        const isEntityCritical = /^[一-龥]{2,3}$/.test(e) && CN_SURNAMES.has(e[0]);
        issues.push({
          kind: 'missing-entity',
          severity: isEntityCritical ? 'warning' : 'info',
          seq: ch.seq,
          title: ch.title,
          message: `第 ${ch.seq} 章声明出场「${e}」，但正文未出现`,
        });
      }
    }
    // 2) 正文里疑似人名但未登记
    //    注意：正文里出现的人名会被记入 observed，但**不因此变成已登记**——
    //    否则「模型自己编了个新角色」这件事永远查不出来。未登记只报 info，不扣分。
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
  const dedupedRaw = issues.filter((i) => {
    const k = `${i.kind}:${i.seq}:${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // 上面的配对逻辑作用在去重后的集合上
  const deduped = dedupedRaw;

  /**
   * 合并配对：同一章里「声明了但没写」与「写了但没登记」若是同长度且共享至少一个字，
   * 实质是同一件事——模型在计划里叫「阿海」，正文里写成「张海」。
   * 分开报会变成两条噪音，合并成一条「疑似改名」才是准确诊断。
   */
  const merged: ConsistencyIssue[] = [];
  const unregByChapter = new Map<number, ConsistencyIssue[]>();
  for (const i of deduped) {
    if (i.kind === 'unregistered-entity' && typeof i.seq === 'number') {
      const list = unregByChapter.get(i.seq) ?? [];
      list.push(i);
      unregByChapter.set(i.seq, list);
    }
  }
  const consumed = new Set<ConsistencyIssue>();
  for (const i of deduped) {
    if (i.kind !== 'missing-entity' || typeof i.seq !== 'number') continue;
    const declaredName = /「([^」]+)」/.exec(i.message)?.[1] ?? '';
    const candidates = unregByChapter.get(i.seq) ?? [];
    const match = candidates.find((u) => {
      if (consumed.has(u)) return false;
      const written = /「([^」]+)」/.exec(u.message)?.[1] ?? '';
      if (!written || written.length !== declaredName.length) return false;
      // 共享至少一个字（阿海 / 张海 共享「海」；陈默 / 陈墨 共享「陈」）
      return [...declaredName].some((ch) => written.includes(ch));
    });
    if (match) {
      consumed.add(match);
      consumed.add(i);
      const written = /「([^」]+)」/.exec(match.message)?.[1] ?? '';
      merged.push({
        kind: 'name-variant',
        severity: 'warning',
        seq: i.seq,
        title: i.title,
        message: `第 ${i.seq} 章计划里写「${declaredName}」，正文里写「${written}」，疑似改名或漏改`,
      });
    }
  }
  const finalIssues = [...deduped.filter((i) => !consumed.has(i)), ...merged];


  const warnings = finalIssues.filter((i) => i.severity === 'warning').length;
  const infos = finalIssues.length - warnings;
  // info 只是「可能相关」的提示，不参与扣分；扣分只来自确定性错误（漏写/改名）
  const score = Math.max(0, 100 - warnings * 8);

  return {
    chapters: chapters.length,
    chars: chapters.reduce((s, c) => s + (c.content || '').length, 0),
    declaredEntities: [...declared].sort(),
    observedEntities: [...observed].sort(),
    issues: finalIssues.slice(0, 200),
    score,
  };
}
