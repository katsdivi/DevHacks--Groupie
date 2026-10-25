import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CubbieImportPayload, cubbieMessage, isAllowedFeedUrl, normalizeFeedUrl, PairCodeString } from './canvas.ts';

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`../../../fixtures/cubbie/${name}`, import.meta.url), 'utf8'));

describe('Cubbie import contract', () => {
  it('accepts the full and text-only fixtures', () => {
    const full = CubbieImportPayload.parse(fixture('import_full.json'));
    expect(full.rubric?.criteria).toHaveLength(6);
    expect(full.attachments?.[0]?.base64?.length).toBeGreaterThan(1000);
    const text = CubbieImportPayload.parse(fixture('import_text_only.json'));
    expect(text.rubric).toBeUndefined();
    expect(text.assignment.pointsPossible).toBeNull();
  });
  it('rejects the malformed fixture', () => {
    expect(CubbieImportPayload.safeParse(fixture('import_malformed.json')).success).toBe(false);
  });
  it('normalizes pair codes and builds the Cubbie message', () => {
    expect(PairCodeString.parse(' k7q2mx ')).toBe('K7Q2MX');
    expect(PairCodeString.safeParse('K7Q2M0').success).toBe(false);
    expect(cubbieMessage('K7Q2MX', 'Project 2')).toBe('Groupie import K7Q2MX Project 2');
  });
});

describe('feed URL rules', () => {
  it('allows only https canvas.asu.edu feeds', () => {
    expect(isAllowedFeedUrl('https://canvas.asu.edu/feeds/calendars/user_abc123.ics')).toBe(true);
    expect(normalizeFeedUrl('webcal://canvas.asu.edu/feeds/calendars/user_abc123.ics')).toBe('https://canvas.asu.edu/feeds/calendars/user_abc123.ics');
    expect(isAllowedFeedUrl('http://canvas.asu.edu/feeds/calendars/user_abc123.ics')).toBe(false);
    expect(isAllowedFeedUrl('https://canvas.asu.edu.evil.com/feeds/x.ics')).toBe(false);
    expect(isAllowedFeedUrl('https://canvas.instructure.com/feeds/x.ics')).toBe(false);
    expect(isAllowedFeedUrl('https://canvas.asu.edu/courses/1')).toBe(false);
    expect(isAllowedFeedUrl('not a url')).toBe(false);
  });
});
