// EmploymentSystem: vacancies -> applications -> offers -> contracts ->
// attendance -> performance -> payroll -> promotion / resignation / dismissal.
import { COURSES, FORKLIFT_PREMIUM } from './training';
import type { Application, Attendance, Business, Contract, GameState, Id, Person, Position, ShiftTemplate, Traits, Vacancy } from './types';
import { at, dayIndex, dayOfWeek, fmtClock, fmtDate, MIN_PER_DAY } from './clock';
import { clamp, nextId, rand } from './core';
import { transfer } from './ledger';
import { addItems } from './inventory';
import { lifeEvent, news } from './events';
import { skillLevel } from './needs';
import { CLOTHING, itemName } from './items';
import { fmtMoney } from './core';
import { isDirty } from './home';

export interface ShiftSlot {
  day: number;
  start: number; // absolute minute
  end: number;
}

export interface InterviewQuestion {
  id: string;
  /** which jobs it is asked for: 'general' or a staff role / job family */
  tags: string[];
  q: string;
  a: string[];
  pts: number[];
  /** how much each kind of interviewer likes each answer (added to pts, scaled by their trait 0..1) */
  likes: Partial<Record<keyof Traits, number>>[];
}

/** the question bank: each interview draws a mix of general and job-specific questions */
export const QUESTIONS: InterviewQuestion[] = [
  { id: 'till_restock', tags: ['cashier', 'general_retail'], q: 'A customer is waiting at the till while you are restocking. What do you do?',
    a: ['Finish the shelf first - stock matters', 'Put the case down and serve them straight away', 'Wave and tell them someone will be along'], pts: [2, 8, 3],
    likes: [{ conscientiousness: 4, sociability: -3 }, { sociability: 3, patience: -1 }, { patience: 3, conscientiousness: -2 }] },
  { id: 'spill', tags: ['general_retail', 'cleaner'], q: 'You notice a spill in an aisle near the end of your shift.',
    a: ['Leave it for the next shift', 'Clean it up and make sure the area is safe', 'Put a sign up and tell the manager'], pts: [0, 8, 6],
    likes: [{ thrift: 1 }, { conscientiousness: 3 }, { sociability: 2, ambition: 2 }] },
  { id: 'why', tags: ['general'], q: 'Why do you want this job?',
    a: ['I need the money, honestly', 'I want to learn how a business runs from the shop floor up', 'It is close to where I live'], pts: [4, 8, 5],
    likes: [{ thrift: 4, ambition: -2 }, { ambition: 4, thrift: -1 }, { patience: 3, conscientiousness: 1 }] },
  { id: 'late', tags: ['general'], q: 'Your bus is cancelled and you are going to be twenty minutes late. What do you do?',
    a: ['Turn up when I can and explain', 'Call ahead straight away and give a time I will be in', 'Take the day off - it is not my fault'], pts: [3, 8, 0],
    likes: [{ patience: 3 }, { conscientiousness: 4 }, { thrift: -2 }] },
  { id: 'strength', tags: ['general'], q: 'What would your last manager say is your biggest strength?',
    a: ['I always turn up and get on with it', 'I get on with everyone and keep people happy', 'I always look for a better way of doing things'], pts: [7, 6, 6],
    likes: [{ conscientiousness: 4 }, { sociability: 5 }, { ambition: 5, patience: -1 }] },
  { id: 'weekends', tags: ['general'], q: 'Some weeks we need cover on a Saturday at short notice. How do you feel about that?',
    a: ['Happy to help when I can', 'Only if it is paid extra', 'I keep my weekends free'], pts: [8, 5, 1],
    likes: [{ sociability: 2, conscientiousness: 2 }, { thrift: 4 }, { patience: 2 }] },
  { id: 'complaint', tags: ['cashier', 'general_retail', 'cafe'], q: 'A customer is angry that an item rang up at the wrong price.',
    a: ['Tell them the till is always right', 'Apologise, check the shelf label and honour the lower price', 'Call the manager over straight away'], pts: [0, 8, 5],
    likes: [{ thrift: 2 }, { sociability: 3, patience: 2 }, { conscientiousness: 2 }] },
  { id: 'cash', tags: ['cashier'], q: 'At the end of your shift your till is ten credits short.',
    a: ['Put ten of my own in so nobody notices', 'Report it honestly and help recount', 'Say nothing - it will even out'], pts: [2, 9, 0],
    likes: [{ patience: 2 }, { conscientiousness: 4 }, {}] },
  { id: 'rotation', tags: ['stocker', 'general_retail'], q: 'You are filling the milk shelf. Where do the new cartons go?',
    a: ['At the front, so they sell first', 'At the back, older dates to the front', 'Wherever there is space'], pts: [2, 9, 0],
    likes: [{ sociability: 1 }, { conscientiousness: 4 }, {}] },
  { id: 'delivery', tags: ['stocker', 'warehouse'], q: 'A delivery arrives and two cases on the invoice are missing.',
    a: ['Sign for it anyway - the driver is in a hurry', 'Note the shortage on the delivery note before signing', 'Refuse the whole delivery'], pts: [0, 9, 3],
    likes: [{ sociability: 2 }, { conscientiousness: 4 }, { ambition: 1 }] },
  { id: 'lifting', tags: ['stocker', 'warehouse', 'driver'], q: 'How would you move a heavy case from a high shelf?',
    a: ['Pull it down quickly', 'Use the step ladder, keep it close and lift with my legs', 'Ask someone else to do it'], pts: [0, 9, 3],
    likes: [{ ambition: 1 }, { conscientiousness: 4 }, { sociability: 2 }] },
  { id: 'clean_route', tags: ['cleaner'], q: 'The shop is busy and the floor near the door is wet from rain.',
    a: ['Wait until it is quiet', 'Put out a wet-floor sign and mop it now, working around people', 'Close the door'], pts: [2, 9, 3],
    likes: [{ patience: 3 }, { conscientiousness: 4 }, { thrift: 2 }] },
  { id: 'cafe_rush', tags: ['cafe'], q: 'There is a queue out of the door at lunchtime.',
    a: ['Work faster and skip the small talk', 'Keep calm, take orders in turn and keep the counter clear', 'Tell people the wait will be long'], pts: [5, 9, 3],
    likes: [{ ambition: 2 }, { patience: 4 }, { sociability: 1 }] },
  { id: 'route', tags: ['driver'], q: 'The road to a delivery is closed.',
    a: ['Drive round the barrier', 'Find another route and call ahead with a new time', 'Bring the goods back to the depot'], pts: [0, 9, 3],
    likes: [{}, { conscientiousness: 3, sociability: 1 }, { patience: 1 }] },
  { id: 'lead_conflict', tags: ['manager'], q: 'Two of your staff keep arguing in front of customers.',
    a: ['Tell them both off on the shop floor', 'Talk to each privately, then agree how they will work together', 'Put them on different shifts and say nothing'], pts: [2, 9, 5],
    likes: [{ ambition: 2 }, { sociability: 3, patience: 2 }, { thrift: 1 }] },
  { id: 'lead_stock', tags: ['manager'], q: 'Sales of crisps have doubled this month. What do you do with the order?',
    a: ['Order double next time', 'Check whether it is a one-off, then raise the order a little and watch it', 'Keep the order the same'], pts: [4, 9, 2],
    likes: [{ ambition: 3 }, { conscientiousness: 3, thrift: 2 }, { thrift: 2 }] },
];

/** older saves and helpers: the first three questions in their original order */
export const INTERVIEW = QUESTIONS.slice(0, 3);

const FAMILY: Record<string, string[]> = {
  cashier: ['cashier', 'general_retail'], stocker: ['stocker', 'general_retail'], cleaner: ['cleaner', 'general_retail'], manager: ['manager', 'general_retail'],
  general: ['general_retail', 'cashier'],
};

/** choose an interview's questions: two general ones and three or four about the job itself */
export function pickQuestions(state: GameState, pos: Position, businessId: Id): string[] {
  const fam = pos.role ? FAMILY[pos.role] : businessId === 'cafe' ? ['cafe'] : businessId === 'wholesale' ? (pos.id === 'driver' ? ['driver', 'warehouse'] : ['warehouse']) : ['general_retail'];
  const shuffled = <T,>(xs: T[]) => xs.map((x) => [rand(state), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const general = shuffled(QUESTIONS.filter((q) => q.tags.includes('general'))).slice(0, 2);
  const job = shuffled(QUESTIONS.filter((q) => !q.tags.includes('general') && q.tags.some((t) => fam.includes(t)))).slice(0, pos.role === 'manager' ? 4 : 3);
  return [...general, ...job].map((q) => q.id);
}

export const questionById = (id: string) => QUESTIONS.find((q) => q.id === id);
export const questionsFor = (a: { questions?: string[] }) => (a.questions?.length ? a.questions.map(questionById).filter((q): q is InterviewQuestion => !!q) : INTERVIEW);


export const business = (state: GameState, id: Id): Business => state.businesses[id];
export function positionOf(state: GameState, c: { businessId: Id; positionId: Id }): Position | undefined {
  return state.businesses[c.businessId]?.positions.find((p) => p.id === c.positionId);
}

export function shiftsOnDay(shifts: ShiftTemplate[], day: number): ShiftSlot[] {
  const dow = day % 7;
  return shifts.filter((s) => s.days.includes(dow)).map((s) => ({ day, start: day * MIN_PER_DAY + s.start, end: day * MIN_PER_DAY + s.end }));
}

/** the shift the contract is in (or about to be in, within `early` minutes) */
export function currentShift(c: Contract, minute: number, early = 30): ShiftSlot | null {
  if (c.status !== 'active') return null;
  const d = dayIndex(minute);
  for (const day of [d - 1, d]) {
    if (day < c.startDay) continue;
    for (const s of shiftsOnDay(c.shifts, day)) if (minute >= s.start - early && minute < s.end) return s;
  }
  return null;
}

export function nextShift(c: Contract, minute: number): ShiftSlot | null {
  if (c.status !== 'active') return null;
  const d = dayIndex(minute);
  for (let day = Math.max(d, c.startDay); day < d + 9; day++) {
    for (const s of shiftsOnDay(c.shifts, day)) if (s.end > minute) return s;
  }
  return null;
}

export const attendanceKey = (cid: Id, day: number) => `${cid}:${day}`;

export function openAttendance(state: GameState, personId: Id): Attendance | null {
  const p = state.people[personId];
  if (!p?.contractId) return null;
  const c = state.contracts[p.contractId];
  const d = dayIndex(state.minute);
  for (const day of [d, d - 1]) {
    const a = state.attendance[attendanceKey(c.id, day)];
    if (a && a.clockIn !== null && a.clockOut === null && !a.closed) return a;
  }
  return null;
}

export const isOnShift = (state: GameState, personId: Id, businessId?: Id) => {
  const a = openAttendance(state, personId);
  if (!a) return false;
  return !businessId || state.contracts[a.contractId].businessId === businessId;
};

export function clockIn(state: GameState, personId: Id): { ok: boolean; msg: string } {
  const p = state.people[personId];
  if (!p.contractId) return { ok: false, msg: 'You do not work here.' };
  const c = state.contracts[p.contractId];
  if (openAttendance(state, personId)) return { ok: false, msg: 'Already clocked in.' };
  const s = currentShift(c, state.minute, 30);
  if (!s) {
    const n = nextShift(c, state.minute);
    return { ok: false, msg: n ? `No shift now. Next shift: ${fmtDate(n.start)} ${fmtClock(n.start)}.` : 'No upcoming shifts.' };
  }
  if (state.minute > s.end - 15) return { ok: false, msg: 'Too late to start this shift.' };
  const key = attendanceKey(c.id, s.day);
  const prev = state.attendance[key];
  if (prev?.closed) return { ok: false, msg: 'This shift has already been recorded.' };
  const pos = positionOf(state, c);
  const uniformOk = !pos?.uniform || p.appearance.outfit === pos.uniform;
  if (p.isPlayer && !uniformOk) return { ok: false, msg: `Uniform required: put on your ${itemName(pos!.uniform!)} at your wardrobe.` };
  const late = Math.max(0, Math.round(state.minute - s.start - 5));
  state.attendance[key] = {
    key, contractId: c.id, day: s.day, scheduledStart: s.start, scheduledEnd: s.end,
    clockIn: state.minute, clockOut: null, minutesWorked: 0, late, tasks: 0, served: 0, waitPenalty: 0,
    uniformOk, paid: false, closed: false, absent: false, score: null, groomed: (p.needs.hygiene ?? 80) >= 30 && !isDirty(p),
  };
  if (p.isPlayer) state.flags.clockedInOnce = true;
  if (p.isPlayer && isDirty(p)) news(state, 'bad', 'Grubby uniform', `Your ${itemName(p.appearance.outfit)} needs a wash (-10 on this shift's score). Use the washing machine at home.`, true);
  if (p.isPlayer) news(state, late > 0 ? 'bad' : 'good', late > 0 ? `Clocked in ${late} min late` : 'Clocked in on time', `Shift until ${fmtClock(s.end)}.`, true);
  return { ok: true, msg: late > 0 ? `Clocked in (${late} min late).` : 'Clocked in. Have a good shift!' };
}

export function clockOut(state: GameState, personId: Id, auto = false): { ok: boolean; msg: string } {
  const a = openAttendance(state, personId);
  if (!a) return { ok: false, msg: 'You are not clocked in.' };
  const p = state.people[personId];
  const out = auto ? a.scheduledEnd : state.minute;
  a.clockOut = out;
  a.minutesWorked = Math.max(0, Math.round(Math.min(out, a.scheduledEnd) - Math.max(a.clockIn!, a.scheduledStart)));
  closeAttendance(state, a, auto);
  if (p.isPlayer) {
    news(state, 'info', `Shift complete - score ${a.score}`, `Worked ${(a.minutesWorked / 60).toFixed(1)}h, ${a.tasks} tasks, ${a.served} customers served.`, true);
  }
  return { ok: true, msg: `Clocked out. Worked ${(a.minutesWorked / 60).toFixed(1)} hours.` };
}

export function scoreShift(a: Attendance): number {
  const hours = Math.max(0.5, (a.scheduledEnd - a.scheduledStart) / 60);
  let s = 70;
  s -= Math.min(30, a.late);
  s += Math.min(25, (a.tasks / hours) * 5) - 10;
  s -= Math.min(25, a.waitPenalty * 0.5);
  if (!a.uniformOk) s -= 15;
  if (a.groomed === false) s -= 10;
  if (a.clockOut !== null && a.clockOut < a.scheduledEnd - 10) s -= Math.min(20, (a.scheduledEnd - a.clockOut) / 3);
  return Math.round(clamp(s, 0, 100));
}

function closeAttendance(state: GameState, a: Attendance, forgot: boolean) {
  if (a.closed) return;
  a.closed = true;
  const c = state.contracts[a.contractId];
  const p = state.people[c.personId];
  if (a.absent) {
    a.score = 0;
    warn(state, c, 'Did not attend a scheduled shift');
  } else {
    a.score = Math.max(0, scoreShift(a) - (forgot ? 5 : 0));
    c.shiftsWorked++;
    if (a.score >= 70) p.reputation = clamp(p.reputation + 1, 0, 100);
    if (a.score < 30) warn(state, c, `Very poor shift performance (${a.score})`);
  }
  c.performance = Math.round(c.shiftsWorked <= 1 && !a.absent ? a.score : c.performance * 0.7 + a.score * 0.3);
}

function warn(state: GameState, c: Contract, reason: string) {
  if (c.status !== 'active') return;
  c.warnings++;
  const p = state.people[c.personId];
  p.reputation = clamp(p.reputation - 5, 0, 100);
  const b = state.businesses[c.businessId];
  if (p.isPlayer) news(state, 'bad', `Formal warning from ${b.name} (${c.warnings}/3)`, reason, true);
  lifeEvent(state, p, `Warning at ${b.name}: ${reason}`);
  if (c.warnings >= 3) endContract(state, c.id, 'dismissed', `Dismissed after repeated warnings (${reason}).`);
}

/** called every simulated minute */
export function employmentTick(state: GameState) {
  const now = state.minute;
  for (const c of Object.values(state.contracts)) {
    if (c.status !== 'active') continue;
    const d = dayIndex(now);
    for (const day of [d - 1, d]) {
      if (day < c.startDay) continue;
      for (const s of shiftsOnDay(c.shifts, day)) {
        if (now < s.end + 60) continue;
        const key = attendanceKey(c.id, day);
        const a = state.attendance[key];
        if (a?.closed) continue;
        if (!a) {
          const rec: Attendance = {
            key, contractId: c.id, day, scheduledStart: s.start, scheduledEnd: s.end, clockIn: null, clockOut: null,
            minutesWorked: 0, late: 0, tasks: 0, served: 0, waitPenalty: 0, uniformOk: false, paid: true, closed: false, absent: true, score: null,
          };
          state.attendance[key] = rec;
          closeAttendance(state, rec, false);
        } else if (a.clockOut === null) {
          clockOut(state, c.personId, true);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- payroll
export function runPayroll(state: GameState) {
  const now = state.minute;
  const dow = dayOfWeek(now);
  const tax = state.policy.incomeTax;
  const gov = state.businesses[state.governmentId];
  const arrearsNoted = new Set<Id>();
  for (const a of Object.values(state.attendance)) {
    if (!a.closed || a.paid || a.minutesWorked <= 0) {
      if (a.closed && a.minutesWorked <= 0) a.paid = true;
      continue;
    }
    const c = state.contracts[a.contractId];
    if (c.payEvery === 'weekly' && dow !== 4) continue;
    const b = state.businesses[c.businessId];
    const p = state.people[c.personId];
    const gross = Math.round((a.minutesWorked * c.wage) / 60);
    const t = Math.round(gross * tax);
    const employerAcc = state.ledger.accounts[b.accountId];
    if (!employerAcc.allowNegative && employerAcc.balance < gross) {
      if (!arrearsNoted.has(c.id)) {
        arrearsNoted.add(c.id);
        if (p.isPlayer) news(state, 'bad', `${b.name} could not pay your wages`, `${fmtMoney(gross)} is owed. Payroll will retry tomorrow.`, true);
      }
      continue;
    }
    const net = transfer(state, { from: b.accountId, to: p.accountId, amount: gross - t, reason: 'wage', memo: `Wages ${b.name} ${fmtDate(a.scheduledStart)}`, ref: a.key, key: `wage:${a.key}` });
    if (!net.ok) continue;
    if (t > 0) transfer(state, { from: b.accountId, to: gov.accountId, amount: t, reason: 'income_tax', memo: `Income tax for ${p.name}`, ref: a.key, key: `tax:${a.key}` });
    a.paid = true;
    statsFor(state, b).wages += gross;
    if (p.isPlayer) news(state, 'money', `Wages received: ${fmtMoney(gross - t)}`, `${(a.minutesWorked / 60).toFixed(1)}h x ${fmtMoney(c.wage)}/h = ${fmtMoney(gross)} gross, ${fmtMoney(t)} income tax withheld.`, true);
  }
}

export function statsFor(state: GameState, b: Business) {
  const day = dayIndex(state.minute);
  let s = b.stats[b.stats.length - 1];
  if (!s || s.day !== day) {
    s = { day, revenue: 0, cogs: 0, wages: 0, otherCosts: 0, customers: 0, lostSales: 0, walkouts: 0 };
    b.stats.push(s);
    if (b.stats.length > 28) b.stats.shift();
  }
  return s;
}

// -------------------------------------------------------------- vacancies
export const filledCount = (state: GameState, bid: Id, pid: Id) =>
  Object.values(state.contracts).filter((c) => c.status === 'active' && c.businessId === bid && c.positionId === pid).length;

export function refreshVacancies(state: GameState) {
  for (const b of Object.values(state.businesses)) {
    for (const pos of b.positions) {
      const open = Object.values(state.vacancies).find((v) => v.businessId === b.id && v.positionId === pos.id && v.status === 'open');
      const need = pos.headcount - filledCount(state, b.id, pos.id);
      if (need > 0 && !open) {
        const v: Vacancy = { id: nextId(state, 'vac'), businessId: b.id, positionId: pos.id, postedAt: state.minute, closesAt: state.minute + 2 * MIN_PER_DAY, status: 'open', applicants: [] };
        state.vacancies[v.id] = v;
        news(state, 'job', `${b.name} is hiring: ${pos.title}`, `${fmtMoney(pos.wage)}/hour. ${pos.playable ? 'Apply at the Job Centre or on your phone.' : 'This role is not yet playable.'}`);
      } else if (need <= 0 && open) {
        open.status = 'filled';
      }
    }
  }
}

export function applicationScore(state: GameState, p: Person, b: Business, pos: Position, answers: number[]): number {
  let s = 35;
  const relevant = Object.keys(pos.requires).length ? Object.keys(pos.requires) : ['retail'];
  for (const k of relevant) s += Math.min(15, skillLevel(p.skills[k] ?? 0) * 5);
  s += p.reputation * 0.2;
  answers.forEach((ai, qi) => (s += INTERVIEW[qi]?.pts[ai] ?? 0));
  s += p.isPlayer ? 8 : p.traits.conscientiousness * 15;
  const dismissedHere = Object.values(state.contracts).some((c) => c.personId === p.id && c.businessId === b.id && c.endReason === 'dismissed');
  if (dismissedHere) s -= 25;
  s += (rand(state) - 0.5) * 8;
  return Math.round(clamp(s, 0, 100));
}

export function canApply(state: GameState, personId: Id, vacancyId: Id): string | null {
  const v = state.vacancies[vacancyId];
  const p = state.people[personId];
  if (!v || v.status !== 'open') return 'This vacancy is no longer open.';
  const b = state.businesses[v.businessId];
  const pos = b.positions.find((x) => x.id === v.positionId)!;
  if (p.isPlayer && !pos.playable) return 'This role is not playable yet.';
  if (v.applicants.some((aid) => state.applications[aid].personId === personId)) return 'You have already applied.';
  if (p.contractId && state.contracts[p.contractId]?.businessId === b.id && state.contracts[p.contractId].positionId === pos.id) return 'You already hold this position.';
  for (const q of pos.quals ?? []) if (!p.quals?.includes(q)) return `Needs a ${COURSES[q]?.name ?? q} qualification (courses at the Job Centre: Phone > Jobs).`;
  for (const [k, xp] of Object.entries(pos.requires)) {
    const have = p.skills[k] ?? 0;
    if (have < xp) return `Needs ${k} experience level ${skillLevel(xp)} (you are level ${skillLevel(have)}: about ${Math.ceil((xp - have) / 12)} more shifts of ${k} work).`;
  }
  return null;
}

export function applyForJob(state: GameState, personId: Id, vacancyId: Id, answers: number[] = []): { ok: boolean; msg: string } {
  const err = canApply(state, personId, vacancyId);
  if (err) return { ok: false, msg: err };
  const v = state.vacancies[vacancyId];
  const b = state.businesses[v.businessId];
  const pos = b.positions.find((x) => x.id === v.positionId)!;
  const p = state.people[personId];
  const app = { id: nextId(state, 'app'), vacancyId, personId, submittedAt: state.minute, status: 'pending' as const, score: applicationScore(state, p, b, pos, answers), answers };
  state.applications[app.id] = app;
  v.applicants.push(app.id);
  if (p.isPlayer) {
    news(state, 'job', `Application sent: ${pos.title} at ${b.name}`, 'The employer reads applications within a couple of hours and will invite you to an interview in person.', true);
    lifeEvent(state, p, `Applied for ${pos.title} at ${b.name}`);
  }
  return { ok: true, msg: 'Application submitted.' };
}

const ROLLING_DELAY = 120; // minutes before an employer reviews an application
const OFFER_THRESHOLD = 60;

/** who interviews for a business: its manager, otherwise an NPC owner */
export function interviewerFor(state: GameState, bid: Id): Person | null {
  const mgr = Object.values(state.contracts).find((c) => c.status === 'active' && c.businessId === bid && c.positionId === 'manager');
  if (mgr) return state.people[mgr.personId];
  const b = state.businesses[bid];
  const owner = state.people[b?.ownerId];
  return owner && !owner.isPlayer ? owner : null;
}

/** the next 30-minute slot at least 90 minutes away when the interviewer is at work */
export function interviewSlot(state: GameState, interviewer: Person, bid: Id): number | null {
  const c = interviewer.contractId ? state.contracts[interviewer.contractId] : null;
  const start = Math.ceil((state.minute + 90) / 30) * 30;
  for (let t = start; t < start + 3 * MIN_PER_DAY; t += 30) {
    const mod = ((t % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
    if (mod < 8 * 60 || mod > 18 * 60) continue;
    if (c && c.businessId === bid) {
      const sh = currentShift(c, t, 0);
      if (sh && t + 60 <= sh.end && t >= sh.start + 30) return t;
    } else if (!c) return t;
  }
  return null;
}

export function processApplications(state: GameState) {
  const now = state.minute;
  for (const v of Object.values(state.vacancies)) {
    if (v.status !== 'open') continue;
    if (state.businesses[v.businessId]?.ownerDecidesHiring) continue; // the owner chooses
    // player applicants are invited to an in-person interview once their CV has been read
    for (const id of v.applicants) {
      const a = state.applications[id];
      const ap = state.people[a.personId];
      if (a.status === 'pending' && ap.isPlayer && now - a.submittedAt >= ROLLING_DELAY) {
        const iv = interviewerFor(state, v.businessId);
        const slot = iv ? interviewSlot(state, iv, v.businessId) : null;
        const b = state.businesses[v.businessId];
        if (a.score < 30) { reject(state, a.id, 'Your CV did not show enough relevant experience.'); continue; }
        if (!iv || slot === null) continue; // try again later
        a.status = 'interview';
        a.interviewAt = slot;
        a.interviewerId = iv.id;
        a.questions = pickQuestions(state, b.positions.find((x) => x.id === v.positionId)!, b.id);
        news(state, 'job', `Interview invitation: ${b.name}`, `Meet ${iv.name} at ${b.name} on ${fmtDate(slot)} at ${fmtClock(slot)}. Find them in person and talk to them. Dress smartly and be on time.`, true);
      }
      if (a.status === 'interview' && a.interviewAt !== undefined && now > a.interviewAt + 60) {
        reject(state, a.id, 'You did not turn up for your interview.');
        ap.reputation = clamp(ap.reputation - 2, 0, 100);
      }
    }
    const apps = v.applicants.map((id) => state.applications[id]).filter((a) => a.status === 'pending' || a.status === 'offered' || a.status === 'interview');
    if (apps.some((a) => a.status === 'offered' || a.status === 'interview')) continue; // waiting for a reply or an interview
    const pending = apps.filter((a) => a.status === 'pending');
    const reviewable = pending.filter((a) => now - a.submittedAt >= ROLLING_DELAY && !state.people[a.personId].isPlayer);
    const best = reviewable.sort((a, b) => b.score - a.score)[0];
    if (best && (best.score >= OFFER_THRESHOLD || now >= v.closesAt)) {
      if (best.score >= 35) makeOffer(state, best.id);
      else reject(state, best.id, 'Your application was not successful this time.');
    } else if (now >= v.closesAt && pending.length === 0) {
      v.closesAt = now + MIN_PER_DAY; // keep advertising
    }
  }
  for (const a of Object.values(state.applications)) {
    if (a.status === 'offered' && a.offerExpires && now > a.offerExpires) {
      a.status = 'expired';
      if (state.people[a.personId].isPlayer) news(state, 'bad', 'A job offer expired', 'You did not respond in time.', true);
    }
  }
}

function makeOffer(state: GameState, appId: Id) {
  const a = state.applications[appId];
  a.status = 'offered';
  a.offerExpires = state.minute + MIN_PER_DAY;
  const v = state.vacancies[a.vacancyId];
  const b = state.businesses[v.businessId];
  const pos = b.positions.find((x) => x.id === v.positionId)!;
  const p = state.people[a.personId];
  if (p.isPlayer) news(state, 'good', `Job offer: ${pos.title} at ${b.name}`, `${fmtMoney(pos.wage)}/hour, paid ${pos.payEvery}. Open Phone > Jobs to accept (expires in 24h).`, true);
}

function reject(state: GameState, appId: Id, note: string) {
  const a = state.applications[appId];
  a.status = 'rejected';
  a.note = note;
  if (state.people[a.personId].isPlayer) news(state, 'bad', 'Application unsuccessful', note, true);
}

/** an interview this person is conducting around now (they may already be waiting at the cafe table) */
export function hostingInterview(state: GameState, personId: Id): Application | null {
  for (const a of Object.values(state.applications)) {
    if (a.interviewerId !== personId || a.status !== 'interview' || a.interviewAt == null) continue;
    if (state.minute >= a.interviewAt - 40 && state.minute <= a.interviewAt + 45) return a;
  }
  return null;
}

export const interviewOpen = (state: GameState, a: Application) => a.status === 'interview' && a.interviewAt !== undefined && state.minute >= a.interviewAt - 45 && state.minute <= a.interviewAt + 60;

/** the face-to-face interview: answers, appearance, hygiene and punctuality decide the outcome on the spot */
/** a small, stable 'chemistry' between two people (-1..1), from their ids */
function chemistry(a: Id, b: Id): number {
  let h = 2166136261;
  for (const ch of a < b ? a + b : b + a) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1;
}

/** Scores an in-person interview. Nothing is fixed: what counts and how much depends on who is
 * interviewing (their traits and mood that day) and on the candidate (experience, rapport). */
export function attendInterview(state: GameState, appId: Id, answers: number[]): { ok: boolean; offered: boolean; score: number; feedback: string[]; msg: string } {
  const a = state.applications[appId];
  if (!a || !interviewOpen(state, a)) return { ok: false, offered: false, score: 0, feedback: [], msg: 'There is no interview to attend right now.' };
  const p = state.people[a.personId];
  const iv = a.interviewerId ? state.people[a.interviewerId] : null;
  const T = iv?.traits ?? { conscientiousness: 0.5, sociability: 0.5, ambition: 0.5, patience: 0.5, thrift: 0.5 };
  const who = iv ? iv.name.split(' ')[0] : 'They';
  const fb: string[] = [];
  let score = a.score;
  let ans = 0;
  const qs = questionsFor(a);
  answers.forEach((ai, qi) => {
    const q = qs[qi];
    if (!q) return;
    let v = q.pts[ai] ?? 0;
    for (const [trait, w] of Object.entries(q.likes?.[ai] ?? {})) v += (w ?? 0) * (T as unknown as Record<string, number>)[trait];
    ans += v;
  });
  score += ans;
  // answers are judged against the number of questions asked
  ans = (ans * 3) / Math.max(1, qs.length);
  fb.push(ans >= 22 ? `${who} liked your answers.` : ans >= 15 ? `${who} thought your answers were reasonable.` : `Your answers did not convince ${iv ? who : 'them'}.`);
  // dress matters more to conscientious interviewers
  const formality = CLOTHING[p.appearance.outfit]?.formality ?? 0;
  const dressW = 2 + 5 * T.conscientiousness;
  score += formality * dressW;
  fb.push(formality >= 2 ? `You were smartly dressed (+${Math.round(formality * dressW)}).` : formality === 1 ? `Neatly dressed (+${Math.round(dressW)}).` : T.conscientiousness > 0.7 ? `${who} noticed you had not dressed up for it.` : 'Casual clothes made no impression either way.');
  if (T.conscientiousness > 0.7 && formality === 0) score -= 4;
  if (isDirty(p)) { const pen = Math.round(3 + 7 * T.conscientiousness); score -= pen; fb.push(`Your clothes were stained and creased (-${pen}).`); }
  // hygiene: the threshold and the penalty depend on the interviewer
  const hyg = p.needs.hygiene ?? 80;
  const hygLimit = 25 + 20 * T.conscientiousness;
  if (hyg < hygLimit) { const pen = Math.round(6 + 8 * T.conscientiousness); score -= pen; fb.push(`Personal hygiene let you down (-${pen}). Shower before important meetings.`); }
  // lateness: patient people forgive more
  const late = Math.max(0, Math.round(state.minute - (a.interviewAt ?? state.minute) - 3));
  if (late > 0) { const pen = Math.min(20, Math.round(late * (0.5 + 1.5 * (1 - T.patience)))); score -= pen; fb.push(`You were ${late} minutes late (-${pen}).`); }
  else fb.push('You arrived on time.');
  // rapport: your mood meets their sociability, plus a little personal chemistry
  const rapport = ((p.needs.mood ?? 60) - 55) / 45 * 6 * (0.4 + T.sociability) + chemistry(p.id, iv?.id ?? 'x') * 4 * T.sociability + (p.traits.sociability - 0.5) * 6;
  score += rapport;
  if (rapport > 3) fb.push(`You got on well with ${who} (+${Math.round(rapport)}).`);
  else if (rapport < -3) fb.push(`The conversation felt awkward (${Math.round(rapport)}).`);
  // experience counts for more with ambitious interviewers
  const exp = Math.min(10, (p.skills.retail ?? 0) / 30) * (0.5 + T.ambition);
  if (exp >= 1) { score += exp; fb.push(`Relevant experience (+${Math.round(exp)}).`); }
  // their own day colours the decision
  if (iv) {
    const dayMood = ((iv.needs.mood ?? 60) - 60) / 8;
    score += dayMood;
    if (dayMood < -2) fb.push(`${who} seemed to be having a bad day.`);
  }
  score = Math.round(clamp(score, 0, 100));
  a.score = score;
  a.answers = answers;
  a.interviewFeedback = fb;
  const bar = OFFER_THRESHOLD + (T.conscientiousness - 0.5) * 10;
  if (score >= bar) {
    a.status = 'offered';
    a.offerExpires = state.minute + MIN_PER_DAY;
    lifeEvent(state, p, `Interviewed at ${state.businesses[state.vacancies[a.vacancyId].businessId].name}: offered the job`);
    return { ok: true, offered: true, score, feedback: fb, msg: 'They offer you the job on the spot!' };
  }
  reject(state, a.id, 'Thank you for coming in, but we have decided not to go ahead.');
  return { ok: true, offered: false, score, feedback: fb, msg: 'Not this time.' };
}

export function acceptOffer(state: GameState, appId: Id): { ok: boolean; msg: string } {
  const a = state.applications[appId];
  if (!a || a.status !== 'offered') return { ok: false, msg: 'No such offer.' };
  const v = state.vacancies[a.vacancyId];
  const p = state.people[a.personId];
  if (p.contractId && state.contracts[p.contractId]?.status === 'active') {
    const old = state.contracts[p.contractId];
    endContract(state, old.id, 'resigned', 'Left to take a new job.');
  }
  a.status = 'accepted';
  const c = hire(state, a.personId, v.businessId, v.positionId);
  // other applicants to the same vacancy are informed once headcount is met
  const b = state.businesses[v.businessId];
  const pos = b.positions.find((x) => x.id === v.positionId)!;
  if (filledCount(state, b.id, pos.id) >= pos.headcount) {
    v.status = 'filled';
    for (const id of v.applicants) if (state.applications[id].status === 'pending') reject(state, id, 'The position has been filled.');
  }
  const first = nextShift(c, state.minute);
  return { ok: true, msg: first ? `Hired! First shift: ${fmtDate(first.start)} ${fmtClock(first.start)}.` : 'Hired!' };
}

export function declineOffer(state: GameState, appId: Id) {
  const a = state.applications[appId];
  if (a?.status === 'offered') a.status = 'declined';
}

export function hire(state: GameState, personId: Id, businessId: Id, positionId: Id, startNow = false): Contract {
  const b = state.businesses[businessId];
  const pos = b.positions.find((x) => x.id === positionId)!;
  const p = state.people[personId];
  // the first shift must start at least 30 minutes after acceptance
  let startDay = dayIndex(state.minute);
  if (!startNow) {
    const todays = shiftsOnDay(pos.shifts, startDay);
    if (todays.some((s) => s.start < state.minute + 30)) startDay++;
  }
  // staff taken on by NPC employers already hold what the job needs; forklift licence holders earn more in the warehouse
  if (!p.isPlayer) for (const q of pos.quals ?? []) if (!p.quals?.includes(q)) (p.quals ??= []).push(q);
  const premium = b.kind === 'wholesale' && p.quals?.includes('forklift') ? FORKLIFT_PREMIUM : 0;
  const c: Contract = {
    id: nextId(state, 'con'), personId, businessId, positionId, title: pos.title, wage: pos.wage + premium, shifts: pos.shifts,
    payEvery: pos.payEvery, startDay, endDay: null, status: 'active', warnings: 0, performance: 60, shiftsWorked: 0,
  };
  state.contracts[c.id] = c;
  p.contractId = c.id;
  if (pos.uniform && p.wardrobeId) addItems(state.containers[p.wardrobeId], pos.uniform, 1);
  lifeEvent(state, p, `Started as ${pos.title} at ${b.name}`);
  if (p.isPlayer) {
    news(state, 'good', `You are now a ${pos.title} at ${b.name}`, pos.uniform ? `Your ${itemName(pos.uniform)} has been delivered to your wardrobe.` : '', true);
  }
  return c;
}

export function endContract(state: GameState, contractId: Id, reason: 'resigned' | 'dismissed' | 'closed', text: string) {
  const c = state.contracts[contractId];
  if (!c || c.status !== 'active') return;
  // close any open shift so it is paid correctly
  const open = openAttendance(state, c.personId);
  if (open && open.contractId === c.id) clockOut(state, c.personId);
  c.status = 'ended';
  c.endReason = reason;
  c.endDay = dayIndex(state.minute);
  const p = state.people[c.personId];
  if (p.contractId === c.id) p.contractId = null;
  const b = state.businesses[c.businessId];
  lifeEvent(state, p, `${reason === 'resigned' ? 'Resigned from' : reason === 'dismissed' ? 'Dismissed from' : 'Left'} ${c.title} at ${b.name}`);
  if (p.isPlayer) news(state, reason === 'dismissed' ? 'bad' : 'info', reason === 'dismissed' ? `Dismissed by ${b.name}` : `You left ${b.name}`, text, true);
  else if (reason === 'dismissed') news(state, 'world', `${b.name} lets a worker go`, `${p.name} was dismissed.`);
  refreshVacancies(state);
}

export function resign(state: GameState, personId: Id) {
  const p = state.people[personId];
  if (p.contractId) endContract(state, p.contractId, 'resigned', 'You handed in your notice. Outstanding wages will still be paid.');
}

// --------------------------------------------------------------- promotion
export function promotionEligible(state: GameState, c: Contract): boolean {
  return c.status === 'active' && !c.promotedFrom && c.shiftsWorked >= 5 && c.performance >= 72 && c.warnings === 0 && state.people[c.personId] !== undefined;
}

export function acceptPromotion(state: GameState, contractId: Id): { ok: boolean; msg: string } {
  const c = state.contracts[contractId];
  if (!c || !promotionEligible(state, c)) return { ok: false, msg: 'Not eligible for promotion yet.' };
  c.promotedFrom = c.title;
  c.title = `Senior ${c.title}`;
  c.wage = Math.round(c.wage * 1.16);
  const p = state.people[c.personId];
  lifeEvent(state, p, `Promoted to ${c.title}`);
  p.reputation = clamp(p.reputation + 5, 0, 100);
  news(state, 'good', `Promoted to ${c.title}`, `New wage ${fmtMoney(c.wage)}/hour.`, p.isPlayer);
  return { ok: true, msg: `Promoted to ${c.title}!` };
}

export const shiftLabel = (s: ShiftTemplate) => {
  const days = s.days.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ');
  return `${days} ${fmtClock(s.start)}-${fmtClock(s.end)}`;
};

export const hoursPerWeek = (shifts: ShiftTemplate[]) => shifts.reduce((h, s) => h + (s.days.length * (s.end - s.start)) / 60, 0);

export { at };
