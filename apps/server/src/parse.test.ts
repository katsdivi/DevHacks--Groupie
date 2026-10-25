import { describe, expect, it } from 'vitest';
import { buildParseMessages, ensureIntegrateTask, formatRubricContext, hasRubric, MAX_CHARS, normalize, truncateForLlm } from './parse.ts';

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

describe('formatRubricContext', () => {
  it('writes one line per criterion with points and ratings', () => {
    const out = formatRubricContext({
      criteria: [
        { name: 'Implementation', points: 40, ratings: ['Full marks: all features work', ' Partial:  some  work '] },
        { name: 'Presentation', points: 1, ratings: [] },
      ],
    });
    expect(out.split('\n')).toEqual([
      'Rubric (criterion (points): ratings):',
      'Implementation (40 pts): Full marks: all features work; Partial: some work',
      'Presentation (1 pt):',
    ]);
    expect(hasRubric(out)).toBe(true);
  });
  it('returns an empty string without criteria', () => {
    expect(formatRubricContext(undefined)).toBe('');
    expect(formatRubricContext({ criteria: [] })).toBe('');
  });
});

describe('buildParseMessages', () => {
  const doc = 'CSE 340 Project 2. Build a campus food finder app with a report and a demo.';
  const now = new Date('2026-10-24T12:00:00Z');
  it('adds rubric rules only when the extra context has a rubric', () => {
    const rubric = formatRubricContext({ criteria: [{ name: 'Report', points: 30, ratings: ['Clear and complete'] }] });
    const [sys, user] = buildParseMessages(doc, 4, rubric, now);
    expect(sys.content).toContain('every rubric criterion is covered by at least one task');
    expect(sys.content).toContain('criteria worth more points get more total effort');
    expect(user.content).toContain('Today is 2026-10-24.');
    expect(user.content).toContain('Report (30 pts): Clear and complete');
    // Lines in the documented format count too, even without our header.
    expect(buildParseMessages(doc, 4, 'Demo (20 pts): works live; slides', now)[0].content).toContain('Rubric rules');
  });
  it('keeps the plain prompt without a rubric', () => {
    for (const extra of [undefined, 'Course: CSE 340. Points possible: 100.']) {
      const [sys, user] = buildParseMessages(doc, 4, extra, now);
      expect(sys.content).not.toContain('Rubric rules');
      expect(sys.content).toContain('Return 8 to 14 tasks');
      expect(user.content).toContain(doc);
    }
  });
});
