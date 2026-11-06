/**
 * unpdf 2.x 的类型补充。
 *
 * unpdf 2 起只发 ESM（exports 里没有 require 条件），而本仓服务端 tsconfig 用
 * `module: commonjs` + `moduleResolution: node`，该组合不读 exports 字段的 types 条件，
 * 因此编译器找不到声明。运行时通过动态 import() 加载（真正的 ESM 加载路径），
 * 这里只声明我们实际用到的 API 形状，避免用 skipLibCheck 或全局放宽掩盖问题。
 */
declare module 'unpdf' {
  export interface ExtractTextResult {
    /** 合并后的纯文本（mergePages: true 时） */
    text: string;
    /** 分页文本（mergePages: false 时） */
    pages?: string[];
  }

  export interface ExtractTextOptions {
    mergePages?: boolean;
  }

  export function extractText(
    data: Uint8Array | ArrayBuffer,
    options?: ExtractTextOptions,
  ): Promise<ExtractTextResult>;
}
