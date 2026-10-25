import { BRAND_COLORS, type SplitCardData } from './splitCard.ts';

/** Realistic 5-member split for previews and visual checks. */
export const sampleSplitCardData: SplitCardData = {
  assignmentTitle: 'Campus Food Finder',
  dueLabel: 'Fri, Nov 20',
  nickname: 'Motu',
  maxGap: 1,
  members: [
    {
      name: 'Divyam',
      color: BRAND_COLORS[0],
      points: 10,
      tasks: [
        { title: 'Implement frontend prototype', effort: 8 },
        { title: 'Summarize interview findings', effort: 2 },
      ],
    },
    {
      name: 'Ava',
      color: BRAND_COLORS[1],
      points: 10,
      tasks: [
        { title: 'Develop backend API', effort: 5 },
        { title: 'Load and clean dataset', effort: 3 },
        { title: 'Practice presentation', effort: 2 },
      ],
    },
    {
      name: 'Jay',
      color: BRAND_COLORS[2],
      points: 10,
      tasks: [
        { title: 'Write requirements document', effort: 5 },
        { title: 'Build clickable mockup', effort: 5 },
      ],
    },
    {
      name: 'Mia',
      color: BRAND_COLORS[3],
      points: 10,
      tasks: [
        { title: 'Prepare final report', effort: 5 },
        { title: 'Conduct user interviews', effort: 3 },
        { title: 'Create presentation slides', effort: 2 },
      ],
    },
    {
      name: 'Leo',
      color: BRAND_COLORS[4],
      points: 9,
      tasks: [
        { title: 'Design wireframes', effort: 3 },
        { title: 'Write unit tests', effort: 3 },
        { title: 'Integrate and proofread', effort: 3 },
      ],
    },
  ],
};

/** Same split with one member having a busy Canvas week, to check the amber tag. */
export const sampleBusySplitCardData: SplitCardData = {
  ...sampleSplitCardData,
  members: sampleSplitCardData.members.map((m) => (m.name === 'Ava' ? { ...m, busyLabel: 'Busy week' } : m)),
  note: 'Ava got fewer points this time: busy week.',
};
