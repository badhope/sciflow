/**
 * 判断本轮聊天是否属于“长文写作”，用于切换 prompt scope。
 *
 * 为什么不能只看 docContext：用户选中了文档也可能只是问一个概念；
 * 只看关键词又容易漏掉“把这段扩成正文”这类说法。这里用动词/产物词做轻量规则，
 * 拿不准时保持 chat 档，避免把 500 字简短约束误删。
 */
const WRITE_ACTION = /(起草|撰写|扩写|续写|改写|润色|写成|写入|保存到文档|更新.{0,4}(文档|正文)|生成.{0,4}(文档|正文|章节|段落|全文|整篇)|写.{0,6}(引言|摘要|方法|讨论|结论|正文|章节|段落|全文|整篇|论文|综述|研究计划|开题|报告|初稿|稿))|(把|将).{0,12}(扩|改|润|续).{0,6}(成|写|一下|一遍)/;
// 已选文档时的编辑/续写动作：这类指令通常很短，不能只靠 40 字兜底放过。
const DOC_EDIT_ACTION = /(扩写|扩展|展开|润色|改写|重写|精简|压缩|重排|重新组织|调整结构|补全|完善|继续.{0,6}(写|扩|润|补|改)|接着.{0,6}(写|扩|润|补|改)|往下写)/;
const DOC_CONTINUE = /^(继续|接着|往下|续写|扩写|补全|完善)(写|改|扩|做|完成|润色)?[。！!…]*$/;

export function isLongformWritingRequest(message: string, docContext?: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  if (WRITE_ACTION.test(text)) return true;
  if (!docContext) return false;
  // 指向明确：已选文档时说“继续/往下/补全”或“扩一下/润一下”，按长文处理。
  if (DOC_CONTINUE.test(text) || DOC_EDIT_ACTION.test(text)) return true;
  // 更长的改写指令：覆盖“前后因果重新组织、过渡句补上”等没有命中上面动词的说法。
  return text.length >= 30 && /(写|改|扩|续|润|组织|调整|重排|重写)/.test(text);
}
