// Training courses at the Job Centre: enrol and pay on your phone, then attend the sessions in person
// at the training desk while the Job Centre is open. Finishing a course gives a qualification that some
// jobs (and driving your own car) require. The driving course ends in a test you can fail.
import type { GameState, Id, Person } from './types';
import { dayIndex, minuteOfDay } from './clock';
import { fmtMoney, rand } from './core';
import { transfer } from './ledger';
import { lifeEvent, news } from './events';

export interface Course { id: string; name: string; fee: number; sessions: number; minutes: number; test?: { pass: number; retest: number }; blurb: string }

export const COURSES: Record<string, Course> = {
  food_hygiene: { id: 'food_hygiene', name: 'Food Hygiene Level 2', fee: 4500, sessions: 2, minutes: 120, blurb: 'Safe food handling, temperatures and cleaning. Needed to cook at the cafe.' },
  driving: { id: 'driving', name: 'Driving licence', fee: 32000, sessions: 4, minutes: 90, test: { pass: 0.75, retest: 6000 }, blurb: 'Theory, lessons and the practical test. Needed to drive the delivery van or your own car.' },
  forklift: { id: 'forklift', name: 'Forklift licence (counterbalance)', fee: 22000, sessions: 3, minutes: 120, blurb: 'Safe lifting and stacking. Warehouse employers pay more for licence holders.' },
  supervision: { id: 'supervision', name: 'Retail Supervision Certificate', fee: 12000, sessions: 3, minutes: 120, blurb: 'Rotas, cash handling and leading a team. Counts towards shop supervisor roles.' },
};

/** extra per hour in the warehouse for forklift licence holders */
export const FORKLIFT_PREMIUM = 150;

/** the last start time so a session finishes by the time the Job Centre closes at 17:00 */
const OPEN = 9 * 60, CLOSE = 17 * 60;

export interface Enrolment { courseId: string; done: number; paid: boolean; lastDay: number }

export function hasQual(p: Person, q: string): boolean {
  return !!p.quals?.includes(q);
}

export function enrolment(p: Person): Enrolment | null {
  return p.course ?? null;
}

export function enrol(state: GameState, personId: Id, courseId: string): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const c = COURSES[courseId];
  if (!p || !c) return { ok: false, msg: 'No such course.' };
  if (hasQual(p, courseId)) return { ok: false, msg: 'You already have that qualification.' };
  if (p.course) return { ok: false, msg: `Finish ${COURSES[p.course.courseId].name} first.` };
  const r = transfer(state, { from: p.accountId, to: state.businesses[state.governmentId].accountId, amount: c.fee, reason: 'public_service', memo: `Course fee: ${c.name}`, key: `course:${personId}:${courseId}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: `The fee is ${fmtMoney(c.fee)}.` };
  p.course = { courseId, done: 0, paid: true, lastDay: -1 };
  news(state, 'info', `Enrolled: ${c.name}`, `${c.sessions} sessions of ${c.minutes / 60} hours at the training desk in the Job Centre (Mon-Fri, 09:00-17:00), one a day.`, p.isPlayer);
  return { ok: true, msg: `Enrolled on ${c.name}.` };
}

/** why the person cannot start a session right now (undefined = they can) */
export function sessionBlocker(state: GameState, p: Person): string | undefined {
  const e = p.course;
  if (!e) return 'Enrol on a course first (Phone > Jobs)';
  const c = COURSES[e.courseId];
  const day = dayIndex(state.minute);
  const dow = day % 7;
  const m = minuteOfDay(state.minute);
  if (dow > 4) return 'Courses run Monday to Friday';
  if (m < OPEN || m + c.minutes > CLOSE) return `Sessions start between 09:00 and ${String(Math.floor((CLOSE - c.minutes) / 60)).padStart(2, '0')}:${String((CLOSE - c.minutes) % 60).padStart(2, '0')}`;
  if (!e.paid) return 'Book your retest first (Phone > Jobs)';
  if (e.lastDay === day) return 'One session a day: come back tomorrow';
  return undefined;
}

export function sessionMinutes(p: Person): number {
  return p.course ? COURSES[p.course.courseId].minutes : 60;
}

/** a session attended in full */
export function completeSession(state: GameState, p: Person): string {
  const e = p.course;
  if (!e) return '';
  const c = COURSES[e.courseId];
  e.done++;
  e.lastDay = dayIndex(state.minute);
  if (e.done < c.sessions) return `Session ${e.done} of ${c.sessions} done: ${c.name}.`;
  if (c.test) {
    // the practical test: steadier with a good night's sleep and a calm mood
    const odds = c.test.pass + (p.needs.energy > 60 ? 0.05 : -0.1) + (p.needs.mood > 60 ? 0.05 : -0.05);
    if (rand(state) > odds) {
      e.done = c.sessions - 1;
      e.paid = false;
      news(state, 'bad', `Failed: ${c.name} test`, `Book a retest for ${fmtMoney(c.test.retest)} on your phone and take it at the training desk.`, p.isPlayer);
      return `You failed the test. A retest costs ${fmtMoney(c.test.retest)}.`;
    }
  }
  (p.quals ??= []).push(c.id);
  p.course = null;
  lifeEvent(state, p, `Qualified: ${c.name}`);
  news(state, 'good', `Qualified: ${c.name}`, 'Added to your CV. Jobs that ask for it are now open to you.', p.isPlayer);
  return `Passed: ${c.name}!`;
}

export function bookRetest(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const p = state.people[personId];
  const e = p?.course;
  const c = e ? COURSES[e.courseId] : null;
  if (!p || !e || !c?.test || e.paid) return { ok: false, msg: 'Nothing to book.' };
  const r = transfer(state, { from: p.accountId, to: state.businesses[state.governmentId].accountId, amount: c.test.retest, reason: 'public_service', memo: `Retest: ${c.name}`, key: `retest:${personId}:${state.minute}` });
  if (!r.ok) return { ok: false, msg: `A retest costs ${fmtMoney(c.test.retest)}.` };
  e.paid = true;
  return { ok: true, msg: 'Retest booked: take it at the training desk.' };
}

/** what an adult in town already holds: fixed per person (from their id), without touching the game's random stream */
export function npcQuals(id: Id): string[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const out: string[] = [];
  if (h % 10 < 7) out.push('driving');
  if ((h >>> 4) % 10 < 5) out.push('food_hygiene');
  if ((h >>> 8) % 10 < 3) out.push('forklift');
  if ((h >>> 12) % 10 < 2) out.push('supervision');
  return out;
}
