import { DemoConfig } from './config.ts';

/** A demo config for tests: one presenter, one more real user, two pretend teammates. */
export const PRESENTER = 7_137_001;
export const REAL2 = 7_137_002;
export const ADMIN = 9_999;

export const testConfig = (): DemoConfig =>
  DemoConfig.parse({
    admins: [ADMIN],
    group: { teamSize: 4, nickname: 'Motu', course: 'CSE 340: Software Engineering', assignmentTitle: 'Project 2: Campus Food Finder', dueInDays: 10 },
    members: [
      { role: 'presenter', telegramUserId: PRESENTER, name: 'Divyam', skills: ['coding'], weakAreas: ['writing'], shareWorkload: true, calendar: 'busy-week' },
      { role: 'teammate1', telegramUserId: null, name: 'Ava', skills: ['writing', 'research'], weakAreas: ['coding'], calendar: 'none' },
      { role: 'teammate2', telegramUserId: REAL2, name: 'Sam', skills: ['design'], weakAreas: [], calendar: 'light' },
      { role: 'teammate3', telegramUserId: null, name: 'Jay', skills: ['data', 'coding'], weakAreas: ['presenting'], calendar: 'none' },
    ],
  });
