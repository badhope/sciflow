import { BadRequestException, Injectable } from '@nestjs/common';
import * as ts from 'typescript';

export interface CodeDiagnostic {
  file: string;
  line: number;
  column: number;
  code: number;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  message: string;
}

export interface DiagnosticsResult {
  ok: boolean;
  language: 'typescript' | 'javascript';
  errors: number;
  warnings: number;
  diagnostics: CodeDiagnostic[];
}

/**
 * 轻量代码诊断：在内存里用 TypeScript compiler API 检查用户提交的 TS/JS。
 *
 * 这不是完整 LSP：不读本地工程、不做跨文件索引、不提供补全/跳转；但能给出
 * 与编辑器同源的类型/语法诊断，足够在科研工作台的代码实验/网页脚本里做提交前自查。
 * 所有代码只存在内存，不落盘；单次最多 100k 字符，避免把编译器当 fuzz 目标。
 */
@Injectable()
export class CodeDiagnosticsService {
  diagnose(code: string, language: 'typescript' | 'javascript' = 'typescript', filename?: string): DiagnosticsResult {
    const source = String(code ?? '');
    if (!source.trim()) throw new BadRequestException('code 不能为空');
    if (source.length > 100_000) throw new BadRequestException('code 超过 100000 字符，请拆小后再诊断');
    const ext = language === 'javascript' ? '.js' : filename?.endsWith('.tsx') ? '.tsx' : '.ts';
    const safeName = (filename || `input${ext}`).replace(/[^\w./-]/g, '_').slice(-120) || `input${ext}`;
    const virtualName = safeName.startsWith('/') ? safeName : `/__sciflow_diagnostics__/${safeName}`;
    const options: ts.CompilerOptions = {
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      allowJs: true,
      checkJs: language === 'javascript',
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      types: [],
      noLib: false,
    };

    const host = ts.createCompilerHost(options, true);
    const defaultGetSourceFile = host.getSourceFile.bind(host);
    const defaultReadFile = host.readFile.bind(host);
    const defaultFileExists = host.fileExists.bind(host);
    host.getCurrentDirectory = () => '/__sciflow_diagnostics__';
    host.fileExists = (name) => name === virtualName || defaultFileExists(name);
    host.readFile = (name) => (name === virtualName ? source : defaultReadFile(name));
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (name === virtualName) return ts.createSourceFile(name, source, languageVersion, true, language === 'javascript' ? ts.ScriptKind.JS : safeName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      return defaultGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    };
    host.writeFile = () => undefined;

    const program = ts.createProgram([virtualName], options, host);
    const raw = ts.getPreEmitDiagnostics(program);
    const diagnostics = raw.slice(0, 50).map((d) => {
      let line = 0;
      let column = 0;
      if (d.file && d.start !== undefined) {
        const lc = d.file.getLineAndCharacterOfPosition(d.start);
        line = lc.line + 1;
        column = lc.character + 1;
      }
      const categoryMap: Record<number, CodeDiagnostic['category']> = {
        [ts.DiagnosticCategory.Error]: 'error',
        [ts.DiagnosticCategory.Warning]: 'warning',
        [ts.DiagnosticCategory.Suggestion]: 'suggestion',
        [ts.DiagnosticCategory.Message]: 'message',
      };
      return {
        file: d.file?.fileName.replace('/__sciflow_diagnostics__/', '') || virtualName,
        line,
        column,
        code: d.code,
        category: categoryMap[d.category] || 'message',
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 500),
      };
    });
    const errors = diagnostics.filter((d) => d.category === 'error').length;
    const warnings = diagnostics.filter((d) => d.category === 'warning').length;
    return { ok: errors === 0, language, errors, warnings, diagnostics };
  }
}
