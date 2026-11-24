/**
 * 统一的 unknown 错误转字符串。
 *
 * 目的：生产代码不再用 `catch (e: any)` 逃逸类型检查；日志与用户提示只需要
 * 一段有界的可读文本，不需要保留原始错误对象。
 */
export function errorMessage(error: unknown, maxLength = 800): string {
  let text: string;
  if (error instanceof Error) {
    text = error.message || error.name;
  } else if (typeof error === 'string') {
    text = error;
  } else {
    try {
      text = JSON.stringify(error);
    } catch {
      text = String(error);
    }
  }
  return text.slice(0, maxLength);
}
