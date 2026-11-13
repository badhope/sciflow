/** 研究计划对象的中文状态标签与色调（页面与子组件共用，避免多套映射漂移） */
export const PROGRAM_STATUS: Record<string, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

export const CYCLE_STATE: Record<string, string> = {
  intake: '接收',
  question: '问题定义',
  landscape: '文献全景',
  gap: '缺口识别',
  hypotheses: '假设',
  protocol: '方案',
  feasibility: '可行性',
  execute: '执行',
  analyze: '分析',
  red_team: '红队评审',
  revise: '修订',
  synthesize: '综合',
  reproduce: '复现',
  report: '报告',
  retrospective: '复盘',
  awaiting_approval: '待审批协议',
  stopped: '已停止',
  blocked: '受阻',
};

export const QUESTION_STATUS: Record<string, string> = {
  open: '开放',
  active: '进行中',
  answered: '已回答',
  abandoned: '已放弃',
};

export const HYPOTHESIS_STATUS: Record<string, string> = {
  proposed: '已提出',
  testing: '验证中',
  supported: '有支持',
  refuted: '被反驳',
  inconclusive: '不确定',
  abandoned: '已放弃',
};

export const PROTOCOL_STATUS: Record<string, string> = {
  draft: '草稿',
  approved: '已批准',
  running: '运行中',
  completed: '已完成',
  abandoned: '已放弃',
};

export const CLAIM_STATUS: Record<string, string> = {
  draft: '草稿',
  supported: '有支持',
  refuted: '被反驳',
  inconclusive: '不确定',
  accepted: '已接受',
  rejected: '已拒绝',
};

export const RUN_STATUS: Record<string, string> = {
  pending: '待运行',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  timeout: '超时',
  cancelled: '已取消',
};

export const EVIDENCE_SOURCE: Record<string, string> = {
  literature: '文献',
  experiment: '实验',
  dataset: '数据集',
  external: '外部来源',
  ai: 'AI 输出',
};

export const EVIDENCE_STANCE: Record<string, string> = {
  supports: '支持',
  refutes: '反驳',
  uncertain: '不确定',
};

export function labelOf(map: Record<string, string>, value: string): string {
  return map[value] || value;
}

export function statusTone(status: string): 'slate' | 'green' | 'amber' | 'red' | 'teal' | 'blue' {
  if (['active', 'approved', 'completed', 'accepted', 'supported'].includes(status)) return 'green';
  if (['paused', 'running', 'testing', 'inconclusive'].includes(status)) return 'amber';
  if (['archived', 'rejected', 'failed', 'timeout', 'refuted', 'abandoned'].includes(status)) return 'red';
  if (['draft', 'pending', 'proposed', 'open'].includes(status)) return 'slate';
  return 'teal';
}
