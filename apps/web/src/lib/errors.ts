/** 统一错误提取：后端 Nest 错误（message）与前端 Error 统一取可读信息。 */
export function errorMessage(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message?: unknown }).message === 'string'
    ? (e as { message: string }).message
    : String(e);
}
