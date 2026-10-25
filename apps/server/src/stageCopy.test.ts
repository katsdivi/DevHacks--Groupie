import { describe, expect, it } from 'vitest';
import * as copy from './copy.ts';
import { canvasCodeText } from './canvas/bot.ts';
import { linkCodeText } from './canvas/link.ts';
import { sizeKeyboard, welcomeKeyboard } from './bot/index.ts';

/**
 * The rehearsed, cached demo strings (docs/DEMO_RUNBOOK.md): the group welcome, [Name me] / [Keep Groupie],
 * the team size prompt, the /canvas reply and the moment 4 answers. These literals were captured before the
 * setup checklist work and must never change by accident.
 */
describe('stage copy stays byte-identical', () => {
  it('welcome and nickname buttons', () => {
    expect(copy.WELCOME).toMatchInlineSnapshot(`"Hey, I'm Groupie, your group project's biggest fan. Want to give me a nickname for this group?"`);
    expect(copy.WELCOME_KEPT).toMatchInlineSnapshot(`"Hey, I'm Groupie, your group project's biggest fan. Groupie it is, love that for us."`);
    expect(copy.KEPT_TOAST).toMatchInlineSnapshot(`"Groupie it is!"`);
    expect(welcomeKeyboard().inline_keyboard).toMatchInlineSnapshot(`
      [
        [
          {
            "callback_data": "nick:name",
            "text": "Name me",
          },
          {
            "callback_data": "nick:keep",
            "text": "Keep Groupie",
          },
        ],
      ]
    `);
  });

  it('team size prompt and follow-ups', () => {
    expect(copy.askSizeText('Motu')).toMatchInlineSnapshot(`"<b>Motu here.</b> How many people are on this project?"`);
    expect(copy.askAssignmentText(4)).toMatchInlineSnapshot(`
      "<b>Team of 4.</b> Love that for us.

      Now drop the assignment file in this chat (PDF, Word, slides) or send /canvas to pull it straight from Canvas, and I'll turn it into tasks with effort points."
    `);
    expect(copy.sizeSetText(4)).toMatchInlineSnapshot(`"<b>Team of 4.</b> Love that for us."`);
    expect(copy.sizeToast(4)).toMatchInlineSnapshot(`"Team of 4!"`);
    expect(sizeKeyboard(4).inline_keyboard).toMatchInlineSnapshot(`
      [
        [
          {
            "callback_data": "size:4",
            "text": "4 (everyone here)",
          },
        ],
        [
          {
            "callback_data": "size:2",
            "text": "2",
          },
          {
            "callback_data": "size:3",
            "text": "3",
          },
          {
            "callback_data": "size:5",
            "text": "5",
          },
          {
            "callback_data": "size:6",
            "text": "6",
          },
        ],
      ]
    `);
  });

  it('/canvas and /imessage replies', () => {
    expect(canvasCodeText('K7Q2MX')).toMatchInlineSnapshot(`
      "Your Cubbie code: <b>K7Q2MX</b>

      <b>1. First time only:</b> text Cubbie this and wait for it to say the skill is installed:
      <code>Install this skill: https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import</code>

      <b>2.</b> Then text Cubbie this within 30 minutes (add the assignment name if you have several), and say yes when it asks:
      <code>Groupie import K7Q2MX</code>

      Cubbie reads the assignment from Canvas and sends it here. The code works once."
    `);
    expect(canvasCodeText('K7Q2MX', { linked: true, hint: 'Sprint 3' })).toMatchInlineSnapshot(`
      "Your Cubbie code: <b>K7Q2MX</b>

      Text Cubbie this within 30 minutes (add the assignment name if you have several), and say yes when it asks:
      <code>Groupie import K7Q2MX Sprint 3</code>

      Cubbie reads the assignment from Canvas and sends it here. The code works once."
    `);
    expect(linkCodeText('K7Q2MX')).toMatchInlineSnapshot(`
      "<b>1. First time only:</b> text Cubbie this and wait for it to say the skill is installed:
      <code>Install this skill: https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import</code>

      <b>2.</b> Then text Cubbie: <code>Groupie link K7Q2MX</code>

      The code works once, for 30 minutes. After that, text Cubbie "Groupie status" to see your tasks, deadlines and next meeting in iMessage."
    `);
  });

  it('moment 4 answers', () => {
    expect(copy.shareLine('Ava')).toMatchInlineSnapshot(`"That's Ava's to share."`);
    expect(copy.REFUSE_INJECTION).toMatchInlineSnapshot(`"Nice try. I only talk about this project in here."`);
    expect(copy.REFUSE_EVERYONE).toMatchInlineSnapshot(`"Nice try. That's each person's to share, and I only talk about this project in here."`);
    expect(copy.DM_SENT).toMatchInlineSnapshot(`"Sent you the rest in DM."`);
    expect(copy.DM_OPENER).toMatchInlineSnapshot(`"Here's the rest of your answer, just between us:"`);
  });
});
