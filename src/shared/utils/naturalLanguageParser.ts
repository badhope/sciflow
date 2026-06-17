import { Priority, TaskStatus, RecurrenceRule } from '../types';

export interface ParsedTask {
  title: string;
  dueDate?: Date;
  priority?: Priority;
  project?: string;
  tags?: string[];
  status?: TaskStatus;
  estimatedTime?: number;
  recurrence?: RecurrenceRule;
  isRecurring?: boolean;
}

const ZH_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

const RELATIVE_DAYS: Record<string, () => Date> = {
  '今天': () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
  '明天': () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d; },
  '后天': () => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(0, 0, 0, 0); return d; },
  '大后天': () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(0, 0, 0, 0); return d; },
  '下周一': () => nextWeekday(1),
  '下周二': () => nextWeekday(2),
  '下周三': () => nextWeekday(3),
  '下周四': () => nextWeekday(4),
  '下周五': () => nextWeekday(5),
  '下周六': () => nextWeekday(6),
  '下周日': () => nextWeekday(0),
  '周一': () => nextWeekday(1, true),
  '周二': () => nextWeekday(2, true),
  '周三': () => nextWeekday(3, true),
  '周四': () => nextWeekday(4, true),
  '周五': () => nextWeekday(5, true),
  '周六': () => nextWeekday(6, true),
  '周日': () => nextWeekday(0, true),
  '周末': () => nextWeekday(0, true),
};

const TIME_KEYWORDS: Array<{ pattern: RegExp; hour: number; minute?: number }> = [
  { pattern: /(早上|早晨|上午|清晨)/, hour: 9 },
  { pattern: /(中午|正午|午间)/, hour: 12 },
  { pattern: /(下午|午后)/, hour: 14 },
  { pattern: /(晚上|傍晚|入夜|晚间)/, hour: 19 },
  { pattern: /(晚上|凌晨|半夜)/, hour: 23 },
  { pattern: /(明早|明晨|明上午)/, hour: 9 },
  { pattern: /(明晚|明晚间)/, hour: 19 },
];

const PRIORITY_PATTERNS: Array<{ pattern: RegExp; priority: Priority }> = [
  { pattern: /!1|紧急|critical|严重/, priority: 'critical' },
  { pattern: /!2|高|important|urgent/, priority: 'urgent' },
  { pattern: /!3|中(?!等)|medium|普通/, priority: 'medium' },
  { pattern: /!4|低|low|不急/, priority: 'low' },
];

const DURATION_PATTERN = /(\d+)\s*(分钟|分|m\b|min\b|hour|小时|h\b)/gi;
const TAG_PATTERN = /#([\u4e00-\u9fa5\w\-_]+)/g;
const PROJECT_PATTERN = /\+([\u4e00-\u9fa5\w\-_]+)/g;
const RECURRING_PATTERN = /每天|每周|每月|每年|every\s+(day|week|month|year)|daily|weekly|monthly|yearly/i;

function nextWeekday(target: number, thisWeek = false): Date {
  const d = new Date();
  const current = d.getDay();
  let daysUntil = target - current;
  if (!thisWeek && daysUntil <= 0) daysUntil += 7;
  if (thisWeek && daysUntil < 0) daysUntil += 7;
  d.setDate(d.getDate() + daysUntil);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseNaturalLanguage(input: string): ParsedTask {
  let title = input.trim();
  const result: ParsedTask = { title: '' };

  // 1. Tags (#tag)
  const tags: string[] = [];
  let m: RegExpExecArray | null;
  const tagRe = new RegExp(TAG_PATTERN.source, 'g');
  while ((m = tagRe.exec(title)) !== null) {
    tags.push(m[1]);
  }
  title = title.replace(tagRe, '').trim();
  if (tags.length) result.tags = tags;

  // 2. Projects (+project)
  const projectRe = new RegExp(PROJECT_PATTERN.source, 'g');
  while ((m = projectRe.exec(title)) !== null) {
    result.project = m[1];
  }
  title = title.replace(projectRe, '').trim();

  // 3. Priority (!1, !2 or keywords)
  for (const { pattern, priority } of PRIORITY_PATTERNS) {
    if (pattern.test(title)) {
      result.priority = priority;
      title = title.replace(pattern, '').trim();
      break;
    }
  }

  // 4. Duration
  const durRe = new RegExp(DURATION_PATTERN.source, 'gi');
  let totalMinutes = 0;
  while ((m = durRe.exec(title)) !== null) {
    const value = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit.includes('hour') || unit.includes('小时') || unit === 'h') {
      totalMinutes += value * 60;
    } else {
      totalMinutes += value;
    }
  }
  title = title.replace(durRe, '').trim();
  if (totalMinutes > 0) result.estimatedTime = totalMinutes;

  // 5. Recurring
  if (RECURRING_PATTERN.test(title)) {
    result.isRecurring = true;
    if (/每天|daily/i.test(title)) {
      result.recurrence = { type: 'daily', endType: 'never', interval: 1, exceptions: [], exceptionsCount: 0 };
    } else if (/每周|weekly/i.test(title)) {
      result.recurrence = { type: 'weekly', endType: 'never', interval: 1, exceptions: [], exceptionsCount: 0 };
    } else if (/每月|monthly/i.test(title)) {
      result.recurrence = { type: 'monthly', endType: 'never', interval: 1, exceptions: [], exceptionsCount: 0 };
    } else if (/每年|yearly/i.test(title)) {
      result.recurrence = { type: 'yearly', endType: 'never', interval: 1, exceptions: [], exceptionsCount: 0 };
    }
    title = title.replace(RECURRING_PATTERN, '').trim();
  }

  // 6. Date - relative day
  for (const [keyword, getDate] of Object.entries(RELATIVE_DAYS)) {
    if (title.includes(keyword)) {
      const baseDate = getDate();
      result.dueDate = baseDate;
      title = title.replace(keyword, '').trim();
      break;
    }
  }

  // 7. Time - keyword based (上午/下午/晚上)
  for (const { pattern, hour } of TIME_KEYWORDS) {
    if (pattern.test(title)) {
      const baseDate = result.dueDate || new Date();
      baseDate.setHours(hour, 0, 0, 0);
      result.dueDate = baseDate;
      title = title.replace(pattern, '').trim();
      break;
    }
  }

  // 8. Time - numeric (3点, 3:30, 15:00)
  const timeRe = /(\d{1,2})[点时:](\d{1,2})?/g;
  while ((m = timeRe.exec(title)) !== null) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    if (hour < 12 && /下午|晚上/.test(input)) hour += 12;
    if (hour === 24) hour = 0;
    const baseDate = result.dueDate || new Date();
    baseDate.setHours(hour, minute, 0, 0);
    result.dueDate = baseDate;
    title = title.replace(m[0], '').trim();
  }

  // 9. Chinese time
  const cnTimeRe = /([一二两三四五六七八九十])[点时]/g;
  while ((m = cnTimeRe.exec(title)) !== null) {
    const cn = m[1];
    const hour = ZH_NUM_MAP[cn] || 0;
    const baseDate = result.dueDate || new Date();
    baseDate.setHours(hour, 0, 0, 0);
    result.dueDate = baseDate;
    title = title.replace(m[0], '').trim();
  }

  // 10. Specific dates (12/25, 2026-06-15, 6月15日)
  const specificDateRe = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})月(\d{1,2})[日号]?/g;
  let dm: RegExpExecArray | null;
  while ((dm = specificDateRe.exec(title)) !== null) {
    if (dm[1]) {
      result.dueDate = new Date(parseInt(dm[1]), parseInt(dm[2]) - 1, parseInt(dm[3]));
    } else if (dm[4]) {
      const now = new Date();
      result.dueDate = new Date(now.getFullYear(), parseInt(dm[4]) - 1, parseInt(dm[5]));
      if (result.dueDate < now) result.dueDate.setFullYear(result.dueDate.getFullYear() + 1);
    }
    if (result.dueDate) result.dueDate.setHours(9, 0, 0, 0);
    title = title.replace(dm[0], '').trim();
    break;
  }

  // 11. Clean title
  title = title
    .replace(/[,，;；]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-_=*~`|]+|[\s\-_=*~`|]+$/g, '')
    .trim();

  result.title = title || input.trim();

  return result;
}

export const NL_EXAMPLES = [
  { input: '明天下午3点 买菜 #购物', expected: '明天 15:00 + 标签' },
  { input: '下周一上午 开会 +工作 !1', expected: '下周一 09:00 + 工作项目 + 紧急' },
  { input: '每天 8点 跑步 30分钟', expected: '每天重复 + 30分钟' },
  { input: '12/25 圣诞节准备 +节日', expected: '12/25 + 节日项目' },
];

export const NL_KEYWORDS_HELP = [
  '今天 / 明天 / 后天',
  '下周一 / 下个月',
  '上午 / 下午 / 晚上',
  '#tag 标签',
  '+project 项目',
  '!1 紧急 / !2 高 / !3 中',
  '30分钟 / 2小时',
  '每天 / 每周 / 每月',
];
