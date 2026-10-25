import type { ProgressCardData } from './progressCard.ts';

type Member = ProgressCardData['members'][number];
type Task = Member['tasks'][number];

function member(name: string, color: string, tasks: Task[]): Member {
  const points = tasks.reduce((n, t) => n + t.effort, 0);
  const donePoints = tasks.filter((t) => t.status === 'done').reduce((n, t) => n + t.effort, 0);
  return { name, color, points, donePoints, percent: points ? Math.round((donePoints / points) * 100) : 0, tasks };
}

const members: Member[] = [
  member('Divyam', '#FF6B5B', [
    { title: 'Implement frontend prototype', effort: 8, status: 'on_track' },
    { title: 'Summarize interview findings', effort: 2, status: 'done' },
  ]),
  member('Ava', '#FFB547', [
    { title: 'Develop backend API', effort: 5, status: 'stuck' },
    { title: 'Load and clean dataset', effort: 3, status: 'done' },
    { title: 'Practice presentation', effort: 2, status: 'todo' },
  ]),
  member('Jay', '#A6E35A', [
    { title: 'Write requirements document', effort: 5, status: 'done' },
    { title: 'Build clickable mockup', effort: 5, status: 'done' },
  ]),
  member('Mia', '#4FD8E8', [
    { title: 'Prepare final report', effort: 5, status: 'todo' },
    { title: 'Conduct user interviews', effort: 3, status: 'done' },
    { title: 'Create presentation slides', effort: 2, status: 'on_track' },
  ]),
  member('Leo', '#A88BFF', [
    { title: 'Design wireframes', effort: 3, status: 'done' },
    { title: 'Write unit tests', effort: 3, status: 'stuck' },
    { title: 'Integrate and proofread', effort: 3, status: 'todo' },
  ]),
];

const totalPoints = members.reduce((n, m) => n + m.points, 0);
const donePoints = members.reduce((n, m) => n + m.donePoints, 0);

/** Realistic 5-member progress snapshot (13 tasks, 49 points) for previews and visual checks. */
export const sampleProgressCardData: ProgressCardData = {
  assignmentTitle: 'Campus Food Finder',
  dueLabel: 'Fri, Nov 20',
  daysLeft: 5,
  nickname: 'Motu',
  percent: Math.round((donePoints / totalPoints) * 100),
  donePoints,
  totalPoints,
  members,
};
