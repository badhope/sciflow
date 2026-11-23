import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import ExcelJS from 'exceljs';
import { buildManuscriptPptx, buildManuscriptXlsx } from './office-export';

const input = {
  title: '测试论文',
  outline: { title: '测试论文', sections: [{ title: '引言', subsections: ['背景', '问题'] }] },
  content: '# 引言\n\n这是第一段。\n\n## 方法\n\n这是第二段。',
  refs: [{ title: 'A Paper', authors: '张三', year: 2024, venue: 'Journal', doi: '10.1/x' }],
};

describe('office export', () => {
  it('builds a valid PPTX zip with slides', async () => {
    const { buffer, filename } = await buildManuscriptPptx(input);
    expect(filename).toBe('测试论文.pptx');
    const zip = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(zip)).toContain('ppt/presentation.xml');
    expect(Object.keys(zip).filter((k) => k.startsWith('ppt/slides/slide') && k.endsWith('.xml')).length).toBeGreaterThan(2);
    expect(strFromU8(zip['ppt/presentation.xml'])).toContain('sldIdLst');
  });

  it('builds a workbook with body/outline/references sheets', async () => {
    const { buffer, filename } = await buildManuscriptXlsx(input);
    expect(filename).toBe('测试论文.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(['正文', '大纲', '参考文献']);
    const body = wb.getWorksheet('正文')!;
    expect(String(body.getCell('C2').value || '')).toContain('第一段');
  });
});
