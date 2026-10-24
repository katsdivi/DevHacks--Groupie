import { describe, expect, it } from 'vitest';
import { ensureIntegrateTask, MAX_CHARS, normalize, truncateForLlm } from './parse.ts';

describe('truncateForLlm', () => {
  it('leaves short text alone', () => {
    expect(truncateForLlm('hello\n\nworld')).toBe('hello\n\nworld');
  });
  it('keeps the head and the rubric, drops filler, stays under budget', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `Background paragraph ${i} ${'lorem ipsum '.repeat(10)}`);
    const doc = [
      'CSE 340 Group Project',
      ...filler.slice(0, 200),
      'Grading Rubric\nCode quality 30%, Report 40%, Demo 30%.',
      'Rubric detail: the report must cite five sources.',
      ...filler.slice(200),
      'Deliverables\nSubmit a zip with code and report by Nov 20.',
    ].join('\n\n');
    const out = truncateForLlm(doc);
    expect(out.length).toBeLessThanOrEqual(MAX_CHARS);
    expect(out.startsWith('CSE 340 Group Project')).toBe(true);
    expect(out).toContain('Code quality 30%');
    expect(out).toContain('Submit a zip with code and report by Nov 20.');
    expect(out).toContain('[...]');
  });
});

describe('normalize', () => {
  it('collapses whitespace but keeps paragraphs', () => {
    expect(normalize('a   b\r\n\n\n\n c\t d')).toBe('a b\n\nc d');
  });
});

describe('ensureIntegrateTask', () => {
  const t = (title: string) => ({ title, description: '', effort: 2 as const, skill_tags: ['writing' as const, 'writing' as const] });
  it('adds one when missing', () => {
    const out = ensureIntegrateTask([t('Write intro')]);
    expect(out.at(-1)?.title).toBe('Integrate and proofread');
    expect(out[0].skill_tags).toEqual(['writing']);
  });
  it('moves an existing one to the end', () => {
    const out = ensureIntegrateTask([t('Final integration and proofreading'), t('Write intro')]);
    expect(out.map((x) => x.title)).toEqual(['Write intro', 'Final integration and proofreading']);
  });
});
