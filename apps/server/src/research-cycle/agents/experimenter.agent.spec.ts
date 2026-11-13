import { describe, it, expect } from 'vitest';
import { sanitizePythonCode } from './experimenter.agent';

/**
 * 模型输出清洗的回归测试。
 * 真实模型（agnes-3.0-flash）第一次真实运行就把代码包在 ```python 围栏里，
 * 直接送沙箱 → SyntaxError → 整轮实验失败。这里锁住清洗规则。
 */
describe('实验者代码清洗', () => {
  it('剥掉 Markdown 围栏', () => {
    const raw = '```python\nimport numpy as np\nprint(np.mean([1,2]))\n```';
    expect(sanitizePythonCode(raw)).toBe('import numpy as np\nprint(np.mean([1,2]))');
  });

  it('剥掉无语言标记的围栏', () => {
    expect(sanitizePythonCode('```\nprint(1)\n```')).toBe('print(1)');
  });

  it('剥掉 python/py 语言标记', () => {
    expect(sanitizePythonCode('```py\nprint(1)\n```')).toBe('print(1)');
  });

  it('处理未闭合围栏（模型输出被截断）', () => {
    const raw = '```python\nimport os\nprint(os.getcwd())';
    expect(sanitizePythonCode(raw)).toBe('import os\nprint(os.getcwd())');
  });

  it('去掉残留的裸 python 首行', () => {
    expect(sanitizePythonCode('python\nprint(1)')).toBe('print(1)');
  });

  it('围栏前后夹解释文字时仍只取代码块', () => {
    const raw = '好的，脚本如下：\n```python\nimport os\nprint(os.getcwd())\n```\n以上。';
    expect(sanitizePythonCode(raw)).toBe('import os\nprint(os.getcwd())');
  });

  it('原样保留没有围栏的干净代码', () => {
    expect(sanitizePythonCode('import os\nprint(1)')).toBe('import os\nprint(1)');
  });

  it('空输入返回空串', () => {
    expect(sanitizePythonCode('')).toBe('');
    expect(sanitizePythonCode(undefined as unknown as string)).toBe('');
  });
});
