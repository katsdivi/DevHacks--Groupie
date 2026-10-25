import type { ParsedTask } from '@groupie/shared';

/**
 * Deterministic task list for the demo assignment, one task per numbered requirement in
 * fixtures/cubbie/import_full.json ("Project 2: Campus Food Finder"), so seeding needs no LLM.
 */
export const DEMO_TASKS: ParsedTask[] = [
  { title: 'Interview 5 students', description: 'Interview at least 5 students about campus food and write a 1 page summary.', effort: 3, skill_tags: ['research', 'writing'] },
  { title: 'Requirements and user stories', description: 'Requirements document with at least 10 user stories and acceptance criteria.', effort: 3, skill_tags: ['writing', 'research'] },
  { title: 'Wireframes and clickable mockup', description: 'Wireframes for at least 4 screens and a clickable mockup.', effort: 5, skill_tags: ['design'] },
  { title: 'Build the prototype', description: 'React prototype with a searchable list of food locations and their hours.', effort: 8, skill_tags: ['coding', 'design'] },
  { title: 'Dining hours data and API', description: 'Load and clean the dining hours CSV and expose it through a simple API.', effort: 5, skill_tags: ['data', 'coding'] },
  { title: 'Unit tests', description: 'Tests for search and hours logic, at least 70 percent coverage.', effort: 3, skill_tags: ['coding', 'math'] },
  { title: 'Final report', description: '6 to 8 page report on design decisions, testing, and reflections.', effort: 5, skill_tags: ['writing', 'editing'] },
  { title: 'Slides and live demo', description: '10 minute in-class presentation with a live demo.', effort: 3, skill_tags: ['presenting', 'design'] },
];

/** Canvas items (same course) for a busy week, due 3 to 6 days out, so they stay out of the 48 h reminder window. */
export const BUSY_WEEK_ITEMS = ['Quiz 4: Design patterns', 'Lab 6: REST APIs', 'Reading response 5', 'Milestone 2 check-in'];
/** The busy week's other classes: private, so they only ever reach the presenter's DM. */
export const OTHER_COURSE_ITEMS = [
  { course: 'MAT 343: Applied Linear Algebra', title: 'Problem set 7' },
  { course: 'ENG 302: Technical Writing', title: 'Memo draft' },
];
/** One item for a lighter week. */
export const LIGHT_ITEMS = ['Lab 6: REST APIs'];
/** The presenter's item due in 3 hours, for the reminder moment. */
export const SOON_ITEM = 'Homework 5: UML diagrams';
