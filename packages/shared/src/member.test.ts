import { describe, expect, it } from 'vitest';
import { MemberRequest } from './api.ts';

describe('MemberRequest', () => {
  it('accepts a minimal member and drops an empty email', () => {
    expect(MemberRequest.parse({ name: ' Divyam ', email: '', skills: ['coding'], weak_areas: [] })).toEqual({
      name: 'Divyam',
      email: undefined,
      skills: ['coding'],
      weak_areas: [],
    });
  });
  it('rejects bad email, unknown skills, and overlaps', () => {
    expect(MemberRequest.safeParse({ name: 'A', email: 'nope', skills: [], weak_areas: [] }).success).toBe(false);
    expect(MemberRequest.safeParse({ name: 'A', skills: ['juggling'], weak_areas: [] }).success).toBe(false);
    expect(MemberRequest.safeParse({ name: 'A', skills: ['math'], weak_areas: ['math'] }).success).toBe(false);
    expect(MemberRequest.safeParse({ name: '', skills: [], weak_areas: [] }).success).toBe(false);
  });
});
