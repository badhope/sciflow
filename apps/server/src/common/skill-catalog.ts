/** 内置科研技能目录（设置页、扩展投影与按需技能加载共用，避免三处各写一份 key）。 */
export interface BuiltinSkillDefinition {
  key: string;
  name: string;
  description: string;
}

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  { key: 'literature_search', name: '文献检索', description: '检索项目文献库（标题/作者/摘要/全文），需要引用具体文献时使用' },
  { key: 'knowledge_qa', name: '知识库问答', description: '基于已上传资料（RAG）回答，回答标注来源文档，事实优先来自资料' },
  { key: 'writing_assist', name: '写作辅助', description: '大纲生成、章节起草、润色、降重、翻译等写作类操作' },
  { key: 'web_research', name: '联网检索', description: '检索公开网页作为背景参考，注意甄别时效与权威性' },
];
