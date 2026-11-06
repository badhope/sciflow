import { describe, expect, it } from 'vitest';
import { extractSections, restoreSection, sectionDiff } from './section-restore';

const DOC = `# Title

Intro paragraph one.

Intro paragraph two.

## Method

Method paragraph.

## Results

Results paragraph.
`;

describe('extractSections', () => {
  it('splits markdown by headings and keeps heading level', () => {
    const sections = extractSections(DOC);
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual(['Title', 'Method', 'Results']);
    expect(sections[0].level).toBe(1);
    expect(sections[1].level).toBe(2);
  });

  it('keeps body text per section', () => {
    const sections = extractSections(DOC);
    expect(sections[1].body).toContain('Method paragraph.');
    expect(sections[0].body).toContain('Intro paragraph one.');
  });

  it('returns an empty list for empty input', () => {
    expect(extractSections('')).toEqual([]);
  });

  it('treats preamble without heading as a leading section', () => {
    const sections = extractSections('Loose preamble.\n\n## A\n\nbody');
    expect(sections[0].level).toBe(0);
    expect(sections[0].body).toContain('Loose preamble.');
  });
});

describe('restoreSection', () => {
  it('replaces only the matching section body', () => {
    const oldDoc = DOC.replace('Method paragraph.', 'Old method text.');
    const restored = restoreSection(oldDoc, DOC, 'Method');
    expect(restored).toContain('Method paragraph.');
    expect(restored).not.toContain('Old method text.');
    expect(restored).toContain('Results paragraph.');
    expect(restored).toContain('Intro paragraph one.');
  });

  it('leaves document untouched when section is missing in the old version', () => {
    expect(restoreSection(DOC, DOC, 'NotThere')).toBe(DOC);
  });

  it('works when the current document no longer has the section', () => {
    const source = '## New Section\n\nfresh content';
    const restored = restoreSection(DOC, source, 'New Section');
    expect(restored).toContain('fresh content');
  });

  it('is idempotent when both versions are identical', () => {
    const once = restoreSection(DOC, DOC, 'Method');
    expect(once).toBe(restoreSection(once, DOC, 'Method'));
    expect(once).toContain('## Results');
    expect(once).toContain('Results paragraph.');
  });
});

describe('sectionDiff', () => {
  it('reports changed and unchanged sections', () => {
    const oldDoc = DOC.replace('Results paragraph.', 'Results changed.');
    const diff = sectionDiff(oldDoc, DOC);
    const method = diff.find((d) => d.title === 'Method');
    const results = diff.find((d) => d.title === 'Results');
    expect(method?.changed).toBe(false);
    expect(results?.changed).toBe(true);
  });

  it('marks sections present only on one side', () => {
    const added = sectionDiff(DOC, '# Title\n\nx\n').find((d) => d.title === 'Method');
    expect(added?.status).toBe('added');
    const removed = sectionDiff('# Title\n\nx\n', DOC).find((d) => d.title === 'Method');
    expect(removed?.status).toBe('removed');
  });
});

describe('replaceSectionBody', () => {
  it('replaces only the target section body and keeps other sections', async () => {
    const { replaceSectionBody } = await import('./section-restore');
    const next = replaceSectionBody(DOC, 'Method', 'Brand new method text.');
    expect(next).toContain('Brand new method text.');
    expect(next).not.toContain('Method paragraph.');
    expect(next).toContain('## Method');
    expect(next).toContain('Results paragraph.');
    expect(next).toContain('Intro paragraph one.');
  });

  it('returns the original text when the section is absent', async () => {
    const { replaceSectionBody } = await import('./section-restore');
    expect(replaceSectionBody(DOC, 'Nope', 'x')).toBe(DOC);
  });

  it('keeps the heading exactly once', async () => {
    const { replaceSectionBody } = await import('./section-restore');
    const next = replaceSectionBody(DOC, 'Method', 'text');
    expect(next.split('## Method').length - 1).toBe(1);
  });
});
