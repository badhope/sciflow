/**
 * 配置权限矩阵（单一来源）。
 *
 * 需求：权限档要能「全面放开」——大部分设置可改，但**核心影响项永远不可改**。
 * 本模块只做判定，不做 IO；控制器/服务/CLI/单测共用，避免四处各写一套白名单。
 */

export type PermissionMode = 'strict' | 'balanced' | 'open' | 'unrestricted';

export const PERMISSION_MODES: { value: PermissionMode; label: string; description: string }[] = [
  { value: 'strict', label: '严格（只读）', description: '所有配置只读，仅允许查看状态与审计' },
  { value: 'balanced', label: '均衡', description: '可改角色/约束/提示词/技能/钩子；权限档与模型/检索配置不可改' },
  { value: 'open', label: '开放', description: '可改除核心保护项外的全部设置，含权限档切换' },
  { value: 'unrestricted', label: '全面放开', description: '默认档：除核心保护项（鉴权/密钥/SSRF/审计/数据库/端口/不可逆操作）外全部可改' },
];

/** 受管配置类别（写操作必须归类，否则拒绝） */
export type ConfigCategory =
  | 'role'
  | 'constraint'
  | 'hook'
  | 'prompt'
  | 'skill'
  | 'intent'
  | 'pipeline'
  | 'quality'
  | 'judgment'
  | 'provider'
  | 'websearch'
  | 'permission';

const BALANCED_ALLOWED: ConfigCategory[] = ['role', 'constraint', 'hook', 'prompt', 'skill'];
const OPEN_ALLOWED: ConfigCategory[] = [
  'role', 'constraint', 'hook', 'prompt', 'skill', 'intent', 'pipeline', 'quality', 'judgment',
  'provider', 'websearch', 'permission',
];

/** 核心保护项：任何档位都不可通过配置中心修改（展示用 + 判定用） */
export const CORE_PROTECTED = [
  { key: 'auth', label: '鉴权与账号', reason: 'AUTH_MODE / JWT_SECRET / 注册开关决定谁能访问全部科研数据' },
  { key: 'secrets', label: '密钥与加密', reason: 'SCIFLOW_SECRET 与 api_key 加密列不可经 UI/CLI 导出或改写' },
  { key: 'ssrf', label: '出站安全（SSRF）', reason: 'ALLOW_PRIVATE_OUTBOUND 与出站守卫保护内网与云元数据' },
  { key: 'audit', label: '审计日志', reason: '配置审计只追加，任何档位不得删除或改写' },
  { key: 'database', label: '数据库路径', reason: 'DATABASE_PATH 迁移错误会导致数据丢失' },
  { key: 'network', label: '监听地址与端口', reason: 'HOST/PORT 变更影响可达性与启动安全闸' },
  { key: 'irreversible', label: '不可逆数据操作', reason: '删除项目/文档/数据库等操作不经配置中心提供' },
] as const;

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  mode: PermissionMode;
  category: ConfigCategory;
}

export function normalizePermissionMode(value: unknown): PermissionMode {
  const v = String(value ?? '').trim();
  return (PERMISSION_MODES.map((m) => m.value) as string[]).includes(v) ? (v as PermissionMode) : 'unrestricted';
}

/** 判定某配置类别在当前档位是否可写 */
export function decidePermission(mode: PermissionMode, category: ConfigCategory): PermissionDecision {
  if (mode === 'strict') {
    return { allowed: false, reason: '当前权限档为「严格（只读）」：请先在权限栏切到均衡/开放/全面放开', mode, category };
  }
  if (mode === 'balanced') {
    const ok = BALANCED_ALLOWED.includes(category);
    return {
      allowed: ok,
      reason: ok ? '' : `当前权限档为「均衡」：${category} 类设置不可改；如需修改请切到开放或全面放开`,
      mode,
      category,
    };
  }
  // open / unrestricted：除权限档本身在 open 档允许；两类档位都允许非核心类别
  const ok = mode === 'open' ? OPEN_ALLOWED.includes(category) : true;
  return {
    allowed: ok,
    reason: ok ? '' : `当前权限档不允许修改 ${category} 类设置`,
    mode,
    category,
  };
}

/** 核心保护项是否被触碰（供 CLI/UI 展示拦截原因，永远 false） */
export function isCoreProtected(key: string): boolean {
  return CORE_PROTECTED.some((c) => c.key === key);
}
