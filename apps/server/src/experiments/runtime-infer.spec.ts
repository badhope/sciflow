import { describe, it, expect } from 'vitest';
import { inferRuntime } from './experiments.service';

/**
 * 运行时推断：用户不指定时按代码特征判断，判断错会让脚本直接语法错。
 * 原则：只认非常明确的特征，其余一律回落 python（历史默认行为）。
 */
describe('沙箱运行时推断', () => {
  it('Python：def / from x import', () => {
    expect(inferRuntime('import numpy as np\nprint(np.mean([1,2]))')).toBe('python');
    expect(inferRuntime('def f(x):\n    return x')).toBe('python');
    expect(inferRuntime('from pathlib import Path')).toBe('python');
  });

  it('Node：const / require / console.log / import from', () => {
    expect(inferRuntime("const x = 1;\nconsole.log(x);")).toBe('node');
    expect(inferRuntime("const fs = require('fs');")).toBe('node');
    expect(inferRuntime("import { readFile } from 'node:fs/promises';")).toBe('node');
  });

  it('Shell：shebang', () => {
    expect(inferRuntime('#!/bin/bash\necho hello')).toBe('shell');
    expect(inferRuntime('#!/bin/sh\necho hi')).toBe('shell');
  });

  it('Shell：Windows 批处理特征', () => {
    expect(inferRuntime('@echo off\necho sum=6')).toBe('shell');
    expect(inferRuntime('set VAR=1\nrem comment\necho %VAR%')).toBe('shell');
  });

  it('无法判断时回落 python（不猜 node）', () => {
    expect(inferRuntime('1 + 1')).toBe('python');
    expect(inferRuntime('')).toBe('python');
  });
});
