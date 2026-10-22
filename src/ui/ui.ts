// UIController: every panel reads authoritative state and requests changes
// through simulation functions; it never computes money or outcomes itself.
import type { Game } from '../game/game';
import type { Business, GameState, Person } from '../sim/types';
import { fmtClock, fmtDate, fmtDuration, dayIndex } from '../sim/clock';
import { fmtMoney } from '../sim/core';
import { accountTxns } from '../sim/ledger';
import { questionsFor } from '../sim/employment';
import { acceptOffer, acceptPromotion, applyForJob, attendInterview, canApply, currentShift, declineOffer, hoursPerWeek, INTERVIEW, nextShift, openAttendance, positionOf, promotionEligible, resign, shiftLabel, scoreShift } from '../sim/employment';
import { conditionLabel, skillLevel } from '../sim/needs';
import { choreStatus } from '../sim/home';
import { weatherLabel } from '../sim/weather';
import { FRIEND_AT, inviteForCoffee, plannedMeetup, relationLabel } from '../sim/social';
import { buyProperty as buyHomeProperty, canBuyHome, mortgageTerms, ownedHome, ownershipLines, redemption, sellHome, SELL_SHARE, SERVICE_CHARGE } from '../sim/property';
import { blockPrice, BLOCK, buyOut, buyOutPrice, holdings, TAKEOVER_AT, buyStake, canInvestIn, dividendsReceived, MAX_STAKE, sellStake, stakeOf, valuation, weeklyProfit } from '../sim/invest';
import { hygieneOf, RATING_LABEL } from '../sim/inspections';
import { personaOf } from '../sim/persona';
import { applyTurn, beginTalk, characterBrief, gesture, parseTurn, remember, speechNotes } from '../sim/talk';
import { aiJson, getApiKey, getModel, hasAi, setApiKey, type ChatTurn } from '../ai/openai';
import { billAccount, billEstimate } from '../sim/bills';
import { MILESTONES, netWorth, wealthTitle } from '../sim/wealth';
import { HOSPITAL, WEAPONS, goToAandE } from '../sim/health';
import { AGENT_FEE, buyNewBuild, forSale, NEW_BUILD_PRICE, NEW_BUILD_RENT, ownedBuilds, RESALE_SHARE, sellNewBuild } from '../sim/lettings';
import { PLOTS } from '../sim/world/plots';
import { bookRetest, COURSES, enrol } from '../sim/training';
import { buyCar, CAR_MODELS, CAR_WEEKLY, FUEL_PER_KM, playerCar, RESALE, sellCar } from '../sim/cars';
import { creditLimit, LOAN_APR_FLAT, LOAN_SIZES, LOAN_WEEKS, repayLoan, takeLoan } from '../sim/bank';
import { buyHome, ONLINE_DELIVERY, quoteHome, storeStaffed } from '../sim/homestore';
import { agenda, currentObjective } from '../sim/objectives';
import { defaultDesign, EXTRAS, FABRICS, FLOORS, RUGS, WALLPAPERS, type HomeDesign } from '../sim/world/homes';
import { cancelAction, startAction } from '../sim/actions';
import { activeLease, reRent } from '../sim/housing';
import { openTasks, inventoryValue, stockPosition } from '../sim/retail';
import { demandFactors } from '../sim/economy';
import { total } from '../sim/inventory';
import { ITEMS, PRODUCTS, itemName } from '../sim/items';
import { getWorld, U4_SECTIONS } from '../sim/world/layout';
import * as E from '../sim/enterprise';
import { isOpen } from '../sim/retail';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

type Tab = 'jobs' | 'work' | 'bank' | 'status' | 'news' | 'map' | 'shop' | 'biz' | 'home' | 'people' | 'car';

export class UI {
  phoneOpen = false;
  tab: Tab = 'jobs';
  menuOpen = false;
  private lastPhoneRender = 0;
  private lastTabs = '';
  private lastBody = '';
  private toastTimer = 0;

  constructor(private game: Game) {
    game.onToast = (m) => this.toast(m);
    game.onApproach = (id) => void this.approached(id);
    game.onAmbientChat = (a, b) => void this.ambientChat(a, b);
    game.onUi = (w, arg) => (w === 'chat' ? this.openChat(arg!, false) : w === 'jobs' || w === 'laptop' ? this.openPhone(w === 'laptop' ? this.tab : 'jobs') : w === 'homestore' ? this.openPhone('home') : w === 'invite' ? this.toast(inviteForCoffee(this.s, this.p.id, arg!).msg) : w === 'interview' ? this.interviewInPerson(arg!) : this.advisor());
    game.onQualityAuto = () => this.toast(`Graphics lowered to ${game.quality === 'medium' ? 'Medium' : 'Low'} for smoother play (Menu > Graphics to change).`);
    game.onFrame = () => this.frame();
    game.onHurt = (n) => { const f = $('#hurt-flash'); f.classList.add('on'); f.style.setProperty('--a', String(Math.min(1, n / 30))); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); };
    game.onGameOver = (cause) => this.gameOver(cause);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Tab' || e.code === 'KeyP') { e.preventDefault(); this.phoneOpen ? this.closePhone() : this.openPhone(this.tab); }
      if (e.code === 'Escape') { if (this.phoneOpen) this.closePhone(); else if ($('#dialog').hidden === false) this.closeDialog(); else this.toggleMenu(); }
    });
    $('#phone').addEventListener('click', (e) => this.onPhoneClick(e));
    $('#phone').addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.dataset.section) { this.toast(E.setSection(this.s, t.dataset.section, t.value || null).msg); this.lastBody = ''; this.renderPhone(); }
      if (t.dataset.home) {
        const [k, room] = t.dataset.home.split('.');
        const v = t.value || null;
        this.draftHome((d) => { if (room) ((d as unknown as Record<string, Record<string, string | null>>)[k])[room] = v; else (d as unknown as Record<string, string | null>)[k] = v; });
      }
      const ex = (t as unknown as HTMLInputElement).dataset.homeExtra;
      if (ex) { const on = (t as unknown as HTMLInputElement).checked; this.draftHome((d) => { d.extras = d.extras.filter((x) => x !== ex); if (on) d.extras.push(ex); }); }
    });
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => { game.speedMult = Number(b.dataset.speed); }));
    $('#btn-phone').addEventListener('click', () => (this.phoneOpen ? this.closePhone() : this.openPhone(this.tab)));
    $('#btn-menu').addEventListener('click', () => this.toggleMenu());
    $('#menu').addEventListener('click', (e) => this.onMenuClick(e));
  }

  get s(): GameState { return this.game.state; }
  get p(): Person { return this.s.people[this.s.playerId]; }

  /** a live dialog (a conversation) keeps the world running */
  liveDialog = false;
  syncModal() { this.game.uiOpen = this.phoneOpen || this.menuOpen || !$('#dialog').hidden; this.game.paused = this.menuOpen || (!$('#dialog').hidden && !this.liveDialog); if (this.game.uiOpen) this.game.releaseMouse(); }

  toast(msg: string) {
    if (!msg) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('#toasts').prepend(t);
    while ($('#toasts').children.length > 4) $('#toasts').lastChild!.remove();
    setTimeout(() => t.classList.add('fade'), 3800);
    setTimeout(() => t.remove(), 4600);
    void this.toastTimer;
  }

  /** the player has died: their story ends; load a save or start a new life */
  gameOver(cause: string) {
    const s = this.s, p = this.p;
    const days = dayIndex(s.minute) + 1;
    const { total } = netWorth(s, p.id);
    const el = $('#gameover');
    el.hidden = false;
    el.innerHTML = `<div class="box"><h1>You died</h1><p>${esc(p.name)}, ${esc(cause)}.</p><p class="muted">Day ${days} in Harbourside · net worth ${fmtMoney(total)} · ${p.record?.length ? `${p.record.length} conviction(s)` : 'a clean record'}.</p>
      <div><button class="primary" data-go="auto">Load autosave</button><button data-go="slot">Load saved game</button><button data-go="new">Start a new life</button></div></div>`;
    el.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.go === 'new') { location.reload(); return; }
      const r = this.game.load(b.dataset.go === 'auto' ? 'bigshot.auto' : 'bigshot.slot1');
      if (r.ok) { el.hidden = true; this.game.paused = false; } else this.toast((r as any).error ?? 'Could not load');
    };
  }

  // ------------------------------------------------------------ HUD
  frame() {
    const s = this.s, p = this.p;
    $('#clock').textContent = fmtClock(s.minute);
    $('#date').textContent = `${fmtDate(s.minute)} · ${weatherLabel(s)}`;
    $('#money').textContent = fmtMoney(s.ledger.accounts[p.accountId].balance);
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === this.game.speedMult));
    $('#sleep-ind').hidden = !p.sleeping;
    setBar('#bar-energy', p.needs.energy);
    setBar('#bar-food', p.needs.satiety);
    setBar('#bar-hygiene', p.needs.hygiene);
    setBar('#bar-mood', p.needs.mood);
    setBar('#bar-health', p.health ?? 100);
    const w = s.wanted;
    $('#wanted').hidden = !w;
    if (w) $('#wanted').innerHTML = `${'★'.repeat(w.level)}<span class="off">${'★'.repeat(5 - w.level)}</span>`;
    $('#weapon-ind').hidden = !p.weapon;
    if (p.weapon) $('#weapon-ind').textContent = `Holding: ${WEAPONS[p.weapon].label} (F to use, Q to put away)`;
    const away = p.away;
    $('#away').hidden = !away && p.down == null;
    if (away) $('#away').innerHTML = `<h2>${away.place === 'hospital' ? HOSPITAL : away.place === 'prison' ? 'HMP Harbourside' : 'Harbourside Police Station'}</h2><div class="muted">${esc(away.reason)}</div><div>Out ${fmtDate(away.until)} ${fmtClock(away.until)}</div><div class="muted">Time passes quickly…</div>`;
    else if (p.down != null) $('#away').innerHTML = '<h2>You are on the ground</h2><div class="muted">An ambulance is on its way.</div>';
    $('#cond').textContent = conditionLabel(p).join(' · ');
    // a time-critical reminder (only shown when it is nearly time to set off) outranks the general goal
    const rem = agenda(s);
    const obj = currentObjective(s);
    $('#objective').hidden = !obj && !rem;
    $('#objective').classList.toggle('urgent', !!rem?.urgent);
    if (rem) $('#objective-text').textContent = rem.text;
    else if (obj) $('#objective-text').textContent = obj.text;
    // shift card
    const att = openAttendance(s, p.id);
    const shiftCard = $('#shift');
    if (att) {
      shiftCard.hidden = false;
      const left = att.scheduledEnd - s.minute;
      const tasks = openTasks(s, s.contracts[att.contractId].businessId);
      const by: Record<string, number> = {};
      for (const t of tasks) by[t.kind] = (by[t.kind] ?? 0) + 1;
      const preview = scoreShift({ ...att, clockOut: null });
      const role = positionOf(s, s.contracts[att.contractId])?.role;
      shiftCard.innerHTML = `<b>On shift</b>${role && role !== 'general' ? ` · ${ROLE_LABEL[role]}` : ''} · ${left > 0 ? `${fmtDuration(left)} left` : '<span class="warn">Shift over: clock out</span>'}<br>
        Tasks done: ${att.tasks} · Served: ${att.served}${att.late ? ` · <span class="warn">${att.late}m late</span>` : ''}<br>
        <span class="muted">Waiting work:</span> ${Object.entries(by).map(([k, n]) => `${n} ${TASK_LABELS[k]?.[n === 1 ? 0 : 1] ?? k}`).join(', ') || 'none'}${(() => { const q = Object.values(s.tills).find((t) => t.businessId === s.contracts[att.contractId].businessId)?.queue.length ?? 0; return q ? ` · <span class="warn">${q} at till</span>` : ''; })()}<br>
        <span class="muted">Score so far ~${preview}</span>`;
    } else shiftCard.hidden = true;
    // interaction prompt
    const f = this.game.focus;
    this.doorWords();
    this.texting();
    this.rowWords();
    const pr = $('#prompt');
    if (!$('#dialog').hidden) pr.hidden = true;
    else if (p.action && p.action.type !== 'attack') {
      const a = p.action;
      const pct = a.duration > 0 ? Math.min(100, (a.progress / a.duration) * 100) : null;
      pr.hidden = false;
      pr.innerHTML = `<div class="busy">${esc(actionLabel(a.type))}${pct !== null && a.type !== 'sit' ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}<span class="muted">Move to stop</span></div>`;
    } else if (f && f.options.length) {
      pr.hidden = false;
      const firstEnabled = f.options.findIndex((o) => o.enabled);
      pr.innerHTML = f.options.map((o, i) => `<div class="opt ${o.enabled ? '' : 'dis'}"><kbd>${i === firstEnabled ? 'E' : i + 1}</kbd>${esc(o.label)}${!o.enabled && o.reason ? `<span class="why">${esc(o.reason)}</span>` : ''}</div>`).join('');
    } else pr.hidden = true;
    if (this.phoneOpen && performance.now() - this.lastPhoneRender > 500) this.renderPhone();
    $('#perf').textContent = `${this.game.frameMs.toFixed(1)} ms`;
  }

  // ------------------------------------------------------------ phone
  openPhone(tab: Tab) {
    this.tab = tab;
    this.phoneOpen = true;
    $('#phone').hidden = false;
    if (tab === 'jobs') this.s.flags.viewedJobs = true;
    this.renderPhone();
    this.syncModal();
  }
  closePhone() { this.phoneOpen = false; $('#phone').hidden = true; this.syncModal(); }

  renderPhone() {
    this.lastPhoneRender = performance.now();
    const tabs: [Tab, string][] = [['jobs', 'Jobs'], ['work', 'Work'], ['bank', 'Bank'], ['biz', 'Business'], ['home', 'Home'], ['people', 'People'], ['car', 'Car'], ['status', 'Me'], ['news', 'News'], ['map', 'Map'], ['shop', 'Market']];
    const unread = this.s.news.filter((n) => n.personal && !n.read).length;
    const tabsHtml = tabs.map(([t, l]) => `<button data-tab="${t}" class="${t === this.tab ? 'on' : ''}">${l}${t === 'news' && unread ? ` <i class="dot">${unread}</i>` : ''}</button>`).join('');
    if (tabsHtml !== this.lastTabs) { $('#phone-tabs').innerHTML = tabsHtml; this.lastTabs = tabsHtml; }
    const body = $('#phone-body');
    const html = this[`tab_${this.tab}`]();
    // only touch the DOM when content changed, so clicks are never lost mid-render
    if (html !== this.lastBody) { const scroll = body.scrollTop; body.innerHTML = html; body.scrollTop = scroll; this.lastBody = html; }
    if (this.tab === 'news') for (const n of this.s.news) n.read = true;
  }

  tab_jobs(): string {
    const s = this.s, p = this.p;
    let h = '';
    const offers = Object.values(s.applications).filter((a) => a.personId === p.id && a.status === 'offered');
    for (const a of offers) {
      const v = s.vacancies[a.vacancyId];
      const b = s.businesses[v.businessId];
      const pos = b.positions.find((x) => x.id === v.positionId)!;
      h += `<div class="card good"><b>Job offer: ${esc(pos.title)}</b><br>${esc(b.name)} · ${fmtMoney(pos.wage)}/h · paid ${pos.payEvery}<br>${pos.shifts.map(shiftLabel).join('; ')} (${hoursPerWeek(pos.shifts)}h/week)<br><span class="muted">Expires ${fmtDate(a.offerExpires!)} ${fmtClock(a.offerExpires!)}</span>
        <div class="row"><button data-accept="${a.id}" class="primary">Accept offer</button><button data-decline="${a.id}">Decline</button></div></div>`;
    }
    for (const a of Object.values(s.applications).filter((x) => x.personId === p.id && x.status === 'interview')) {
      const v = s.vacancies[a.vacancyId];
      const b = s.businesses[v.businessId];
      const iv = s.people[a.interviewerId!];
      h += `<div class="card good"><b>Interview booked</b><br>${esc(b.name)} with <b>${esc(iv.name)}</b><br>${fmtDate(a.interviewAt!)} at <b>${fmtClock(a.interviewAt!)}</b> at the window table in Tidewater Cafe<br><span class="muted">${esc(iv.name.split(' ')[0])} will be waiting at the table: sit down opposite (E). ${a.questions?.length ?? 3} questions. Smart clothes and a shower help; being late costs points.</span></div>`;
    }
    h += '<h3>Open vacancies</h3>';
    const vacs = Object.values(s.vacancies).filter((v) => v.status === 'open');
    if (!vacs.length) h += '<p class="muted">No open vacancies right now. Employers post new ones when they are short of staff.</p>';
    for (const v of vacs) {
      const b = s.businesses[v.businessId];
      const pos = b.positions.find((x) => x.id === v.positionId)!;
      const err = canApply(s, p.id, v.id);
      const mine = Object.values(s.applications).find((a) => a.vacancyId === v.id && a.personId === p.id);
      h += `<div class="card"><b>${esc(pos.title)}</b> <span class="tag">${pos.playable ? 'Playable' : 'Not yet playable'}</span><br>${esc(b.name)} · <b>${fmtMoney(pos.wage)}/h</b> · paid ${pos.payEvery}<br>
        <span class="muted">${pos.shifts.map(shiftLabel).join('; ')} · ${hoursPerWeek(pos.shifts)}h/week${pos.uniform ? ` · uniform: ${itemName(pos.uniform)}` : ''}</span>
        ${Object.keys(pos.requires).length ? `<br><span class="${err?.startsWith('Needs') ? 'warn' : 'muted'}">Experience: ${Object.entries(pos.requires).map(([k, xp]) => `${k} level ${skillLevel(xp)}`).join(', ')}</span>` : ''}
        ${pos.description ? `<p>${esc(pos.description)}</p>` : ''}${pos.duties.length ? `<ul>${pos.duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <span class="muted">${v.applicants.length} applicant(s) · closes ${fmtDate(v.closesAt)}</span>
        <div class="row">${mine ? `<span class="tag">Application ${mine.status}</span>` : err ? `<span class="muted">${esc(err)}</span>` : `<button data-apply="${v.id}" class="primary">Apply</button>`}</div></div>`;
    }
    const apps = Object.values(s.applications).filter((a) => a.personId === p.id && a.status !== 'offered');
    if (apps.length) {
      h += '<h3>Your applications</h3>';
      for (const a of apps) {
        const v = s.vacancies[a.vacancyId];
        const pos = s.businesses[v.businessId].positions.find((x) => x.id === v.positionId)!;
        h += `<div class="line"><span>${esc(pos.title)} · ${esc(s.businesses[v.businessId].name)}</span><span class="tag">${a.status}</span></div>`;
      }
    }
    // training courses at the Job Centre
    const e = p.course;
    h += `<h3>Courses at the Job Centre</h3><p class="muted">Pay here, then attend each session at the training desk (Mon-Fri 09:00-17:00, one a day).${p.quals?.length ? ` Your qualifications: ${p.quals.map((q) => esc(COURSES[q]?.name ?? q)).join(', ')}.` : ''}</p>`;
    if (e) {
      const c = COURSES[e.courseId];
      h += `<div class="card good"><b>${esc(c.name)}</b><div class="line"><span>Sessions attended</span><span>${e.done} / ${c.sessions}${c.test ? ' (the last is the test)' : ''}</span></div>${!e.paid && c.test ? `<p class="warn">You failed the test.</p><div class="row"><button data-retest="1" class="primary">Book a retest (${fmtMoney(c.test.retest)})</button></div>` : ''}</div>`;
    }
    for (const c of Object.values(COURSES)) {
      if (p.quals?.includes(c.id) || e?.courseId === c.id) continue;
      h += `<div class="card"><b>${esc(c.name)}</b> · ${fmtMoney(c.fee)}<br><span class="muted">${esc(c.blurb)} ${c.sessions} × ${c.minutes / 60} h.</span><div class="row"><button data-enrol="${c.id}" ${e ? 'disabled title="One course at a time"' : ''}>Enrol</button></div></div>`;
    }
    return h;
  }

  tab_work(): string {
    const s = this.s, p = this.p;
    if (!p.contractId) return '<p>You are not employed. Check <b>Jobs</b> for vacancies.</p>' + this.history();
    const c = s.contracts[p.contractId];
    const b = s.businesses[c.businessId];
    const pos = positionOf(s, c);
    const cur = currentShift(c, s.minute, 30);
    const next = nextShift(c, s.minute);
    const atts = Object.values(s.attendance).filter((a) => a.contractId === c.id).sort((a, b2) => b2.day - a.day).slice(0, 6);
    return `<div class="card"><b>${esc(c.title)}</b> at ${esc(b.name)}<br>${fmtMoney(c.wage)}/hour · paid ${c.payEvery} at 22:00${c.payEvery === 'weekly' ? ' on Fridays' : ''} · income tax ${Math.round(s.policy.incomeTax * 100)}%<br>
      ${c.shifts.map(shiftLabel).join('; ')}<br>
      Performance <b>${c.performance}</b>/100 · shifts worked ${c.shiftsWorked} · warnings <b class="${c.warnings ? 'warn' : ''}">${c.warnings}/3</b><br>
      ${pos?.uniform ? `Uniform: ${itemName(pos.uniform)} (${p.appearance.outfit === pos.uniform ? 'wearing' : '<span class="warn">not wearing</span>'})<br>` : ''}
      ${cur ? `<b>Shift now:</b> ${fmtClock(cur.start)}-${fmtClock(cur.end)}` : next ? `Next shift: ${fmtDate(next.start)} ${fmtClock(next.start)}-${fmtClock(next.end)}` : ''}</div>
      ${promotionEligible(s, c) ? `<div class="card good"><b>Promotion available</b><br>Your manager offers you a senior role (+16% pay).<div class="row"><button class="primary" data-promote="${c.id}">Accept promotion</button></div></div>` : `<p class="muted">Promotion needs 5+ shifts, performance 72+ and no warnings.</p>`}
      <h3>How performance is scored</h3><p class="muted">Start at 70. Lose a point per minute late, lose points for customers left waiting at the till and for leaving early, gain up to +15 for tasks per hour, and lose 15 without the uniform.</p>
      <h3>Recent shifts</h3>${atts.map((a) => `<div class="line"><span>${fmtDate(a.scheduledStart)}</span><span>${a.absent ? '<span class="warn">absent</span>' : `${(a.minutesWorked / 60).toFixed(1)}h · ${a.tasks} tasks · score ${a.score ?? '…'} · ${a.paid ? 'paid' : 'unpaid'}`}</span></div>`).join('') || '<p class="muted">None yet.</p>'}
      <div class="row"><button data-resign="1">Resign</button></div>${this.history()}`;
  }

  history() {
    const h = this.p.history.slice(-8).reverse();
    return h.length ? `<h3>Life history</h3>${h.map((e) => `<div class="line"><span class="muted">${fmtDate(e.time)}</span><span>${esc(e.text)}</span></div>`).join('')}` : '';
  }

  tab_bank(): string {
    const s = this.s, p = this.p;
    const acc = s.ledger.accounts[p.accountId];
    const l = activeLease(s, p.id);
    const ended = Object.values(s.leases).find((x) => x.tenantId === p.id && x.status === 'ended' && !x.bought) && !activeLease(s, p.id) && !ownedHome(s, p.id) ? Object.values(s.leases).find((x) => x.tenantId === p.id && x.status === 'ended' && !x.bought) : undefined;
    const own = ownedHome(s, p.id);
    const buy = canBuyHome(s, p.id);
    const txns = accountTxns(s, acc.id, 30);
    return `<div class="card"><span class="muted">Current account</span><div class="big">${fmtMoney(acc.balance)}</div></div>
      <h3>Obligations</h3>
      ${own ? `<div class="card"><b>You own ${esc(own.label)}</b>${ownershipLines(s, p.id).slice(1).map((x) => `<div class="line"><span>${esc(x)}</span></div>`).join('')}<div class="line"><span>Service charge</span><span>${fmtMoney(SERVICE_CHARGE)} a week</span></div>${own.mortgage?.missed ? `<div class="line warn"><span>Missed payments</span><span>${own.mortgage.missed}/3</span></div>` : ''}<div class="line"><span>To pay it off now</span><span>${fmtMoney(redemption(own))}</span></div><div class="row"><button data-sellhome="1">Sell (to the landlord, ${fmtMoney(Math.round(own.price * SELL_SHARE))})</button></div></div>` : ''}
      ${!own && l && buy.price ? (() => { const t = mortgageTerms(buy.price); return `<div class="card"><b>Buy ${esc(l.label)}</b> for ${fmtMoney(buy.price)}<div class="line"><span>Deposit (10%)</span><span>${fmtMoney(t.deposit)}</span></div><div class="line"><span>Mortgage</span><span>${fmtMoney(t.weekly)} a week for 10 years</span></div>${buy.ok ? '<div class="row"><button class="primary" data-buyhome="1">Buy it</button></div>' : `<p class="muted">${esc(buy.reason)}</p>`}</div>`; })() : ''}
      ${(() => { const e = billEstimate(s, p.id), ba = billAccount(s, p.id); return `<div class="line"><span>Energy so far (${Math.round(ba.kwh)} kWh) + council tax</span><span>${fmtMoney(e.total)} on ${fmtDate(ba.nextBill)}</span></div>${ba.arrears ? `<div class="line warn"><span>Bill arrears</span><span>${fmtMoney(ba.arrears)}</span></div>` : ''}`; })()}
      ${l ? `<div class="line"><span>Rent · ${esc(l.label)}</span><span>${fmtMoney(l.weeklyRent)} every Monday 09:00</span></div><div class="line"><span>Paid until</span><span>${fmtDate(l.paidThroughDay * 1440)}</span></div>${l.arrears ? `<div class="line warn"><span>Arrears (${l.missedPayments}/3 missed)</span><span>${fmtMoney(l.arrears)}</span></div>` : ''}` : '<p class="warn">You have no home.</p>'}
      ${ended ? `<div class="card"><b>${esc(ended.label)}</b> is available again for ${fmtMoney(ended.arrears + ended.weeklyRent)} (arrears + 1 week).<div class="row"><button data-rerent="${ended.id}" class="primary">Rent again</button></div></div>` : ''}
      ${(() => {
        const loan = Object.values(s.loans ?? {}).find((x) => x.personId === p.id && x.status === 'active');
        if (loan) return `<h3>Loan</h3><div class="line"><span>Still owed</span><span>${fmtMoney(loan.owed)}</span></div><div class="line"><span>Next payment</span><span>${fmtMoney(Math.min(loan.weekly, loan.owed))} on ${fmtDate(loan.nextDue)}</span></div>${loan.missed ? `<div class="line warn"><span>Missed payments</span><span>${loan.missed}/3</span></div>` : ''}<div class="row"><button data-loanrepay="${loan.id}">Settle early</button></div>`;
        const c = creditLimit(s, p.id);
        return `<h3>Borrow</h3><p class="muted">Harbourside Savings: ${esc(c.reason)} ${LOAN_WEEKS} weekly repayments, ${Math.round(LOAN_APR_FLAT * 100)}% total interest.</p>${c.limit ? `<div class="row">${LOAN_SIZES.filter((a) => a <= c.limit).map((a) => `<button data-loan="${a}">Borrow ${fmtMoney(a)}</button>`).join('')}</div>` : ''}`;
      })()}
      <h3>Invest</h3><p class="muted">Buy shares in local businesses ${BLOCK}% at a time (outsiders may hold up to ${MAX_STAKE}%). Shareholders get their part of the owner's draw every Sunday.${dividendsReceived(s, p.id) ? ` Dividends so far: ${fmtMoney(dividendsReceived(s, p.id))}.` : ''}</p>
      ${Object.values(s.businesses).filter((b) => canInvestIn(b) && b.ownerId !== p.id).map((b) => { const mine = stakeOf(b, p.id); const wp = weeklyProfit(s, b); return `<div class="card${mine ? ' good' : ''}"><b>${esc(b.name)}</b>${mine ? ` <span class="tag">you hold ${mine}%</span>` : ''}<div class="line"><span>Valued at</span><span>${fmtMoney(valuation(s, b))}</span></div><div class="line"><span>Weekly profit (recent)</span><span class="${wp >= 0 ? 'pos' : 'neg'}">${fmtMoney(wp)}</span></div><div class="row"><button data-stakebuy="${b.id}">Buy ${BLOCK}% · ${fmtMoney(blockPrice(s, b))}</button>${mine ? `<button data-stakesell="${b.id}">Sell ${BLOCK}%</button>` : ''}${mine >= TAKEOVER_AT ? `<button class="primary" data-buyout="${b.id}">Buy the rest · ${fmtMoney(buyOutPrice(s, b, p.id))}</button>` : ''}</div></div>`; }).join('')}
      ${(() => {
        const mine = ownedBuilds(s, p.id), sale = forSale(s);
        if (!mine.length && !sale.length) return '';
        return `<h3>Property to let</h3><p class="muted">New houses on Harbour Road, let through Harbourside Lettings: ${fmtMoney(NEW_BUILD_RENT)} a week less ${Math.round(AGENT_FEE * 100)}%.</p>`
          + mine.map((b) => { const pl = PLOTS.find((x) => x.id === b.plotId)!; return `<div class="card good"><b>${esc(pl.name)}</b><div class="line"><span>Tenant</span><span>${b.tenant ? esc(b.tenant) : 'being found'}</span></div>${b.nextRent ? `<div class="line"><span>Next rent</span><span>${fmtDate(b.nextRent)}</span></div>` : ''}<div class="row"><button data-letsell="${b.plotId}">Sell (${fmtMoney(Math.round(b.price * RESALE_SHARE))})</button></div></div>`; }).join('')
          + sale.map(({ plot }) => `<div class="card"><b>${esc(plot.name)}</b> · new build · ${fmtMoney(NEW_BUILD_PRICE)}<div class="row"><button data-letbuy="${plot.id}" ${s.ledger.accounts[p.accountId].balance >= NEW_BUILD_PRICE ? '' : 'disabled'}>Buy to let</button></div></div>`).join('');
      })()}
      <h3>Transactions</h3>${txns.map((t) => `<div class="line"><span><span class="muted">${fmtDate(t.time).split(',')[1]} ${fmtClock(t.time)}</span> ${esc(t.memo)}</span><span class="${t.to === acc.id ? 'pos' : 'neg'}">${t.to === acc.id ? '+' : '-'}${fmtMoney(t.amount).replace('Cr ', '')}</span></div>`).join('') || '<p class="muted">No transactions yet.</p>'}`;
  }

  tab_status(): string {
    const s = this.s, p = this.p;
    const bag = s.containers[p.bagId];
    const pantry = p.pantryId ? s.containers[p.pantryId] : null;
    const inv = (c: typeof bag | null) => c && total(c) ? Object.entries(c.items).map(([k, n]) => `${n}× ${itemName(k)}`).join(', ') : 'empty';
    return `<div class="card"><b>${esc(p.name)}</b><br>Energy ${p.needs.energy.toFixed(0)} · Food ${p.needs.satiety.toFixed(0)} · Hygiene ${p.needs.hygiene.toFixed(0)} · Mood ${p.needs.mood.toFixed(0)}<br><span class="muted">${conditionLabel(p).join(' · ') || 'Feeling fine'}</span><br>${choreStatus(s, p).length ? `<span class="muted">Home: ${esc(choreStatus(s, p).join(' · '))}</span><br>` : ''}Professional reputation ${p.reputation.toFixed(0)}/100<br>Health ${(p.health ?? 100).toFixed(0)}/100${p.injured ? ` · <span class="neg">injured (${esc(p.injured.cause)})</span>` : ''}${p.drunk && p.drunk > 20 ? ' · drunk' : ''}${(p.health ?? 100) < 90 || p.injured ? '<div class="row"><button data-ae="1">Go to A&amp;E at St Mary\'s</button></div>' : ''}${p.record?.length ? `<br><span class="muted">Criminal record: ${esc(p.record.join('; '))}</span>` : ''}</div>
      ${(() => { const w = netWorth(s, p.id); return `<h3>Net worth · ${esc(wealthTitle(w.total))}</h3><div class="card"><div class="big">${fmtMoney(w.total)}</div>${w.lines.map((l) => `<div class="line"><span>${esc(l.label)}</span><span class="${l.amount < 0 ? 'neg' : ''}">${fmtMoney(l.amount)}</span></div>`).join('')}${(() => { const next = MILESTONES.find((m) => m > w.total); return next ? `<p class="muted">Next milestone: ${fmtMoney(next)}</p>` : ''; })()}</div>`; })()}
      <h3>Effects</h3><p class="muted">Below 25 energy you move and work 20% slower (36% below 10). Starving slows work. Sleep in your bed to recover. Eat food from your kitchen or a cafe meal.</p>
      <h3>Skills</h3>${['retail', 'cleaning', 'warehouse', 'cooking', 'construction'].map((k) => `<div class="line"><span>${k}</span><span>level ${skillLevel(p.skills[k] ?? 0)} (${p.skills[k] ?? 0} xp)</span></div>`).join('')}
      <p class="muted">Each level makes related work 6% faster and improves job applications.</p>
      <h3>Inventory</h3><div class="line"><span>Shopping bag</span><span>${inv(bag)}</span></div><div class="line"><span>Kitchen</span><span>${inv(pantry)}</span></div>
      <h3>Goals</h3>${s.objectives.map((o) => `<div class="line"><span>${o.done ? '✔' : '○'} ${esc(o.text)}</span></div>`).join('')}`;
  }

  /** everyone you know: how well, when you last saw them, and invitations */
  tab_car(): string {
    const s = this.s, p = this.p;
    const car = playerCar(s, p.id);
    const bal = s.ledger.accounts[p.accountId].balance;
    if (car) {
      const back = Math.round((car.price ?? 0) * RESALE * (0.6 + 0.4 * car.condition / 100));
      return `<div class="card good"><b>Your ${esc(car.name)}</b> <i class="sw" style="background:${car.color}"></i>
        <div class="line"><span>Where</span><span>${car.state === 'parked' ? `parked ${Math.round(Math.hypot(car.pos.x - p.pos.x, car.pos.z - p.pos.z))} m from you` : 'you are driving it'}</span></div>
        <div class="line"><span>Distance driven</span><span>${(car.odometer / 1000).toFixed(1)} km</span></div>
        <div class="line"><span>Insurance & road tax</span><span>${fmtMoney(CAR_WEEKLY)} a week${car.nextCharge ? `, next ${fmtDate(car.nextCharge)}` : ''}</span></div>
        ${car.uninsured ? '<p class="warn">Uninsured: the car stays parked until the insurance is paid.</p>' : ''}
        <p class="muted">Walk up to the driver's door and press E to get in. While driving: W/S to drive, A/D to steer, E to park and get out. Fuel is paid when you park (${fmtMoney(FUEL_PER_KM)} per km).</p>
        <div class="row"><button data-carsell="1" ${car.state === 'parked' ? '' : 'disabled'}>Sell to Harbour Motors (${fmtMoney(back)})</button></div></div>`;
    }
    return `${p.quals?.includes('driving') ? '' : '<p class="warn">You need a driving licence to drive (course and test at the Job Centre: Phone &gt; Jobs). You can still buy a car now.</p>'}<p class="muted">Harbour Motors delivers to the kerb outside Marlow Court. Running costs: insurance and road tax ${fmtMoney(CAR_WEEKLY)} a week, fuel ${fmtMoney(FUEL_PER_KM)} per km. You have ${fmtMoney(bal)}.</p>
      ${CAR_MODELS.map((m) => `<div class="card"><b>${esc(m.name)}</b> · ${fmtMoney(m.price)}<br><span class="muted">${esc(m.blurb)} Top speed ${Math.round(m.topSpeed * 3.6)} km/h.</span>
        <div class="row">${m.colors.map((c) => `<button data-carbuy="${m.id}|${c}" ${bal >= m.price ? '' : 'disabled'} title="Buy in this colour"><i class="sw" style="background:${c}"></i>Buy</button>`).join('')}</div></div>`).join('')}`;
  }

  tab_people(): string {
    const s = this.s, p = this.p;
    const known = Object.entries(p.relations).filter(([id, v]) => v > 0 && s.people[id]).sort((a, b) => b[1] - a[1]);
    const m = plannedMeetup(s);
    let h = `<p class="muted">Chat to people to get to know them. Friends lift your mood; invite them for a coffee to keep in touch, or friendships fade.</p>`;
    const inbox = (s.inbox ?? []).slice(-6).reverse();
    if (inbox.length) h += `<h3>Messages</h3>${inbox.map((x) => `<div class="card"><b>${esc(s.people[x.from]?.name ?? '?')}</b> <span class="muted">${fmtClock(x.at)}${dayIndex(x.at) < dayIndex(s.minute) ? `, day ${dayIndex(x.at) + 1}` : ''}</span>${x.read ? '' : ' <span class="pos">new</span>'}<br>${esc(x.text)}<div class="row"><button data-reply="${x.from}" data-at="${x.at}">Reply</button></div></div>`).join('')}`;
    if (m) h += `<div class="card">Coffee with <b>${esc(s.people[m.friendId].name)}</b> at ${fmtClock(m.at)}${dayIndex(m.at) > dayIndex(s.minute) ? ' tomorrow' : ''} - Tidewater Cafe, corner table.</div>`;
    if (!known.length) return h + '<p class="muted">You do not know anyone yet. Say hello to your colleagues and neighbours.</p>';
    for (const [id, v] of known) {
      const o = s.people[id];
      const c = o.contractId ? s.contracts[o.contractId] : null;
      const job = c ? `${c.title} at ${s.businesses[c.businessId]?.name ?? ''}` : o.npc?.retired ? 'Retired' : 'Looking for work';
      const seen = p.lastSeen?.[id];
      h += `<div class="card"><b>${esc(o.name)}</b> <span class="tag">${relationLabel(v)}</span><br><span class="muted">${esc(job)}${seen ? ` · last seen ${fmtDate(seen).split(',')[1]} ${fmtClock(seen)}` : ''}</span>
        <div class="bar"><i style="width:${Math.round(v)}%"></i></div><div class="row">${this.s.people[id]?.knowsYou?.number ? `<button data-msg="${id}">Message</button>` : ''}${v >= FRIEND_AT && !m ? `<button data-invite="${id}">Invite for a coffee</button>` : ''}</div></div>`;
    }
    return h;
  }

  tab_news(): string {
    return this.s.news.slice(0, 60).map((n) => `<div class="news ${n.kind}"><span class="muted">${fmtDate(n.time).split(',')[1]} ${fmtClock(n.time)}${n.personal ? ' · you' : ''}</span><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>`).join('');
  }

  tab_map(): string {
    const w = getWorld();
    const p = this.p;
    const sx = (x: number) => ((x - w.bounds.x0) / (w.bounds.x1 - w.bounds.x0)) * 300;
    const sz = (z: number) => ((z - w.bounds.z0) / (w.bounds.z1 - w.bounds.z0)) * 193;
    const rect = (r: { x0: number; z0: number; x1: number; z1: number }) => `x="${sx(r.x0)}" y="${sz(r.z0)}" width="${sx(r.x1) - sx(r.x0)}" height="${sz(r.z1) - sz(r.z0)}"`;
    const cat = { functional: '#2e8b57', simplified: '#c48a2c', decorative: '#8c949c' };
    let svg = `<svg viewBox="0 0 300 193" class="map">`;
    for (const r of w.roads) svg += `<rect ${rect(r.rect)} fill="${r.kind === 'road' || r.kind === 'lane' ? '#4a4f55' : r.kind === 'grass' ? '#7fae63' : '#b9b6ae'}"/>`;
    for (const b of w.buildings) svg += `<rect ${rect(b.rect)} fill="${cat[b.category]}" stroke="#222" stroke-width=".3"><title>${b.name}</title></rect>`;
    svg += `<circle cx="${sx(p.pos.x)}" cy="${sz(p.pos.z)}" r="2.6" fill="#ff3b30" stroke="#fff" stroke-width=".8"/></svg>`;
    const legend = w.buildings.filter((b) => b.category !== 'decorative' && !b.id.startsWith('house_')).map((b) => `<div class="line"><span><i class="sw" style="background:${cat[b.category]}"></i>${esc(b.name)}</span><span class="muted">${esc(b.role)}</span></div>`).join('');
    return `${svg}<p class="muted"><i class="sw" style="background:#2e8b57"></i>usable &nbsp; <i class="sw" style="background:#c48a2c"></i>simulated, limited access &nbsp; <i class="sw" style="background:#8c949c"></i>background only</p>${legend}`;
  }

  tab_shop(): string {
    const s = this.s;
    const b = s.businesses.market;
    const f = demandFactors(s, b);
    const days = b.stats.slice(-7);
    const row = (d: typeof days[0]) => `<div class="line"><span>Day ${d.day + 1}</span><span>rev ${fmtMoney(d.revenue)} · gross ${fmtMoney(d.revenue - d.cogs)} · ${d.customers} cust · ${d.lostSales} lost · ${d.walkouts} walkouts</span></div>`;
    const isStaff = this.p.contractId && s.contracts[this.p.contractId]?.businessId === 'market';
    return `<p class="muted">Public information about Corner Market${isStaff ? ' plus staff view' : ''}. Figures are actual records.</p>
      <div class="card">Reputation <b>${b.reputation.toFixed(0)}</b>/100 · cleanliness ${b.cleanliness.toFixed(0)}%<br>
      Demand factors: reputation ×${f.rep.toFixed(2)}, cleanliness ×${f.clean.toFixed(2)}, prices ×${f.price.toFixed(2)}, stock availability ×${f.availability.toFixed(2)}, weather ×${f.weather.toFixed(2)}, hygiene rating ×${f.hygiene.toFixed(2)}</div>
      <h3>Food hygiene ratings</h3>${Object.values(s.businesses).filter((x) => x.kind === 'retail' || x.kind === 'cafe').map((x) => { const h = hygieneOf(s, x.id); const last = h?.history[h.history.length - 1]; return `<div class="line"><span>${esc(x.name)}${last ? `<br><span class="muted">${esc(last.notes.join('; '))} · ${fmtDate(last.day * 1440).split(',')[0]}</span>` : ''}</span><span>${h?.rating !== null && h?.rating !== undefined ? `<b class="${h.rating >= 4 ? 'pos' : h.rating <= 2 ? 'neg' : ''}">${h.rating}/5</b> ${esc(RATING_LABEL[h.rating])}` : '<span class="muted">awaiting inspection</span>'}</span></div>`; }).join('')}
      ${isStaff ? `<h3>Stock (shelf / total incl. orders)</h3>${PRODUCTS.map((k) => `<div class="line"><span><i class="sw" style="background:${ITEMS[k].color}"></i>${itemName(k)}</span><span>${s.containers['shelf_' + k].items[k] ?? 0} / ${stockPosition(s, b, k)}</span></div>`).join('')}
      <div class="line"><span>Stock value at cost</span><span>${fmtMoney(inventoryValue(s, b))}</span></div>` : ''}
      <h3>Recent days</h3>${days.map(row).join('') || '<p class="muted">No trading recorded yet.</p>'}`;
  }

  /** decorate and arrange the home: choose from the Harbour Home catalogue, pay, and it is fitted at your flat */
  tab_home(): string {
    const s = this.s;
    const cur = s.homeDesigns.flat ?? defaultDesign(1);
    const d = this.homeDraft ?? cur;
    const sel = (name: string, key: string, opts: Record<string, { name: string } | string>, cur: string | null, none = false) =>
      `<label class="line"><span>${name}</span><select data-home="${key}">${none ? `<option value="" ${!cur ? 'selected' : ''}>None</option>` : ''}${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${typeof v === 'string' ? k[0].toUpperCase() + k.slice(1) : v.name}</option>`).join('')}</select></label>`;
    const rooms = [['living', 'Living room'], ['kitchen', 'Kitchen'], ['hall', 'Hall'], ['bedroom', 'Bedroom'], ['bathroom', 'Bathroom']];
    const q = quoteHome(cur, d);
    const atCounter = this.p.where === 'homestore';
    const staffed = storeStaffed(s);
    const pend = s.pendingHome;
    let h = `<h3>Flat 1, Marlow Court</h3><p class="muted">Pick from the Harbour Home catalogue below. Buy at the store's counter, or order online for ${fmtMoney(ONLINE_DELIVERY)} delivery; it is fitted at your flat. Moving the furniture around is free.</p>
      ${pend ? `<div class="card">Order on its way: fitting at ${fmtClock(pend.fitAt)}${dayIndex(pend.fitAt) > dayIndex(s.minute) ? ' tomorrow' : ''}.</div>` : ''}
      ${q.lines.length ? `<div class="card"><b>Your basket</b>${q.lines.map((l) => `<div class="line"><span>${esc(l.what)}</span><span>${fmtMoney(l.price)}</span></div>`).join('')}<div class="line"><b>Total</b><b>${fmtMoney(q.total)}</b></div>
        <div class="row"><button data-home-buy="counter" class="primary" ${atCounter && staffed && !pend ? '' : 'disabled'}>Pay at the counter</button><button data-home-buy="online" ${pend ? 'disabled' : ''}>Order online (+${fmtMoney(ONLINE_DELIVERY)})</button><button data-home-reset="1">Clear</button></div>
        ${!atCounter ? '<p class="muted">Paying in person: Harbour Home, by the bus stop on the west side of the high street (Mon-Sat 09:00-18:00).</p>' : !staffed ? '<p class="muted">Nobody is at the counter right now.</p>' : ''}</div>` : ''}
      <div class="row"><button data-home-rearrange="1">Rearrange the furniture (free)</button></div>
      <h3>Furniture</h3>${sel('Sofa & armchair fabric', 'sofa', FABRICS, d.sofa)}${sel('Bedding', 'bedding', FABRICS, d.bedding)}
      ${sel('Living room rug', 'rug.living', RUGS, d.rug.living ?? null, true)}${sel('Bedroom rug', 'rug.bedroom', RUGS, d.rug.bedroom ?? null, true)}
      <h3>Extras</h3>${Object.entries(EXTRAS).map(([k, x]) => `<label class="line"><span>${x.name}</span><input type="checkbox" data-home-extra="${k}" ${d.extras.includes(k) ? 'checked' : ''}></label>`).join('')}
      <h3>Walls & floors</h3>`;
    for (const [id, name] of rooms) h += `<div class="card"><b>${name}</b>${sel('Walls', `wallpaper.${id}`, WALLPAPERS, d.wallpaper[id] ?? null)}${sel('Floor', `floor.${id}`, FLOORS, d.floor[id] ?? null)}</div>`;
    return h;
  }

  /** the catalogue selections waiting to be bought */
  homeDraft: HomeDesign | null = null;
  private draftHome(f: (d: HomeDesign) => void) {
    const d: HomeDesign = JSON.parse(JSON.stringify(this.homeDraft ?? this.s.homeDesigns.flat ?? defaultDesign(1)));
    f(d);
    this.homeDraft = d;
    this.lastBody = '';
    this.renderPhone();
  }

  private changeHome(f: (d: HomeDesign) => void) {
    const s = this.s;
    const d: HomeDesign = JSON.parse(JSON.stringify(s.homeDesigns.flat ?? defaultDesign(1)));
    f(d);
    s.homeDesigns.flat = d;
    this.game.applyHomeDesign();
    this.lastBody = '';
    this.renderPhone();
  }

  tab_biz(): string {
    const s = this.s, p = this.p;
    const b = E.playerBusiness(s);
    const myBal = s.ledger.accounts[p.accountId].balance;
    const held = holdings(s, p.id).filter((h) => h.id !== E.UNIT4);
    const heldHtml = held.length ? `<h3>Your companies</h3>${held.map((h) => { const st = h.stats.slice(-7); const sum = (f: (x: typeof st[number]) => number) => st.reduce((a, x) => a + f(x), 0); const staff = Object.values(s.contracts).filter((c) => c.businessId === h.id && c.status === 'active').length; return `<div class="card good"><b>${esc(h.name)}</b><div class="line"><span>Cash</span><span>${fmtMoney(s.ledger.accounts[h.accountId].balance)}</span></div><div class="line"><span>Last 7 days: sales / wages</span><span>${fmtMoney(sum((x) => x.revenue))} / ${fmtMoney(sum((x) => x.wages))}</span></div><div class="line"><span>Staff</span><span>${staff}</span></div><div class="line"><span>Reputation</span><span>${Math.round(h.reputation)}</span></div></div>`; }).join('')}` : '';
    if (!b) {
      return heldHtml + this.foundCard(myBal);
    }
    return heldHtml + this.ownBiz(b);
  }

  foundCard(myBal: number): string {
    const s = this.s, p = this.p;
    {
      const taken = !!s.businesses[E.UNIT4];
      return `<div class="card"><b>Property to let: Dockside Unit 4</b><br><span class="muted">Empty shop unit on the east end of Main Street. Shelving for four product lines, counter, store room, goods-in door.</span>
        <div class="line"><span>Rent</span><span>${fmtMoney(E.UNIT4_RENT)}/week</span></div><div class="line"><span>Deposit</span><span>${fmtMoney(E.UNIT4_DEPOSIT)}</span></div>
        <div class="line"><span>Business registration</span><span>${fmtMoney(E.REGISTRATION_FEE)}</span></div><div class="line"><span>Till system (needed to sell)</span><span>${fmtMoney(E.TILL_COST)}</span></div>
        <p class="muted">You also need money for opening stock (about Cr 1 per item from Harbour Wholesale) and for wages if you hire staff. Location: quieter than Corner Market, so fewer passing customers.</p>
        ${taken ? '<p class="warn">Already let.</p>' : `<label class="muted" for="biz-name">Business name</label><input id="biz-name" type="text" maxlength="28" value="${esc(p.name.split(' ')[0])}'s Store">
        <p>Invest from your account (you have ${fmtMoney(myBal)}):</p><div class="row">${[E.START_MIN_CAPITAL + E.TILL_COST + 20000, 100000, 150000, 250000].map((a) => `<button data-found="${a}" class="${myBal >= a ? 'primary' : ''}" ${myBal >= a ? '' : 'disabled'}>${fmtMoney(a)}</button>`).join('')}</div>
        <p class="muted">Minimum ${fmtMoney(E.START_MIN_CAPITAL)} covers deposit, first week and registration only.</p>`}</div>`;
    }
  }

  ownBiz(b: Business): string {
    const s = this.s;
    const acc = s.ledger.accounts[b.accountId];
    const days = b.stats.slice(-7);
    const sum = (k: 'revenue' | 'cogs' | 'wages' | 'otherCosts' | 'customers' | 'lostSales' | 'walkouts') => days.reduce((a, d) => a + d[k], 0);
    const profit = sum('revenue') - sum('cogs') - sum('wages') - sum('otherCosts');
    const open = isOpen(b, s.minute);
    const checklist = [
      ['Lease & registration', true], ['Till system', !!b.equipment.till], ['Products chosen', Object.keys(b.sections).length > 0],
      ['Stock on shelves', Object.entries(b.sections).some(([sh, k]) => (s.containers[sh].items[k] ?? 0) > 0)], ['Someone at the till during opening hours', true],
    ] as const;
    const shipments = Object.values(s.shipments).filter((x) => x.buyerId === b.id && x.status !== 'received');
    const staff = Object.values(s.contracts).filter((c) => c.businessId === b.id && c.status === 'active');
    const apps = Object.values(s.applications).filter((a) => a.status === 'pending' && s.vacancies[a.vacancyId]?.businessId === b.id);
    const sectionRow = (sct: { id: string }, i: number) => {
      const k = b.sections[sct.id];
      const c = s.containers[sct.id];
      const n = k ? c.items[k] ?? 0 : 0;
      const back = k ? s.containers.unit4_backroom.items[k] ?? 0 : 0;
      const opts = ['', ...PRODUCTS].map((x) => `<option value="${x}" ${x === (k ?? '') ? 'selected' : ''}>${x ? itemName(x) : 'none'}</option>`).join('');
      return `<div class="card"><b>Section ${i + 1}</b> <select data-section="${sct.id}">${opts}</select> ${k ? `<span class="muted">shelf ${n}/30 · store room ${back}</span>` : ''}
        ${k ? `<div class="row">Price <button data-price="${k}" data-d="-0.05">−5%</button><b>${fmtMoney(b.prices[k])}</b><button data-price="${k}" data-d="0.05">+5%</button><span class="muted">wholesale ${fmtMoney(s.businesses.wholesale.prices[k])} · usual ${fmtMoney(ITEMS[k].retail)}</span></div>
        <div class="row">Order <button data-order="${k}" data-q="1">1 case (${ITEMS[k].caseSize})</button><button data-order="${k}" data-q="3">3 cases</button></div>` : ''}</div>`;
    };
    const hyg = hygieneOf(s, b.id);
    return `<div class="card"><b>${esc(b.name)}</b> · Dockside Unit 4 · <span class="${open ? 'pos' : 'warn'}">${open ? 'OPEN' : 'CLOSED'}</span>${b.outage && s.minute < b.outage.until ? ` <span class="warn">power cut ${fmtClock(b.outage.from)}–${fmtClock(b.outage.until)}</span>` : ''} · hygiene ${hyg?.rating !== null && hyg?.rating !== undefined ? `<b>${hyg.rating}/5</b>` : 'not yet rated'}<br>
      Business cash <b>${fmtMoney(acc.balance)}</b> · reputation ${b.reputation.toFixed(0)}
      <div class="row"><button data-invest="10000">Invest Cr 100</button><button data-invest="50000">Invest Cr 500</button><button data-withdraw="10000">Withdraw Cr 100</button><button data-closed="${b.manualClosed ? '0' : '1'}">${b.manualClosed ? 'Open doors' : 'Close doors'}</button><button data-nightfill="${b.nightFill ? '0' : '1'}">${b.nightFill ? 'Cancel night-fill crew' : 'Hire night-fill crew'}</button></div>
      <div class="row">${Object.entries(E.HOURS_PRESETS).map(([k, h]) => `<button data-hours="${k}" class="${JSON.stringify(b.open) === JSON.stringify(h.open) ? 'primary' : ''}">${h.label}</button>`).join('')}</div></div>
      <h3>Getting ready</h3>${checklist.map(([t, d]) => `<div class="line"><span>${d ? '✔' : '○'} ${t}</span></div>`).join('')}
      ${!b.equipment.till ? `<div class="row"><button class="primary" data-till="1">Buy till system (${fmtMoney(E.TILL_COST)})</button></div>` : ''}
      <p class="muted">Customers only pay when someone is at the till: you (standing in your shop) or a clocked-in employee. Without anyone there they leave empty-handed.</p>
      <h3>Shelf sections & stock</h3>${U4_SECTIONS.map(sectionRow).join('')}
      ${shipments.map((x) => `<div class="line"><span>Order ${x.id}: ${Object.entries(x.items).map(([k, n]) => `${n} ${itemName(k)}`).join(', ')}</span><span class="tag">${x.status === 'arrived' ? 'at goods-in: check it in' : x.status}</span></div>`).join('')}
      <h3>Last 7 days (actual)</h3>
      <div class="line"><span>Sales (excl. tax)</span><span>${fmtMoney(sum('revenue'))}</span></div><div class="line"><span>Cost of goods sold</span><span>-${fmtMoney(sum('cogs'))}</span></div>
      <div class="line"><span>Wages</span><span>-${fmtMoney(sum('wages'))}</span></div><div class="line"><span>Rent, utilities & fees</span><span>-${fmtMoney(sum('otherCosts'))}</span></div>
      <div class="line"><b>Operating profit</b><b class="${profit >= 0 ? 'pos' : 'neg'}">${fmtMoney(profit)}</b></div>
      <div class="line"><span>Customers · lost sales · walk-outs</span><span>${sum('customers')} · ${sum('lostSales')} · ${sum('walkouts')}</span></div>
      <p class="muted">Cash is not profit: stock you buy leaves the account before it is sold.</p>
      <h3>Staff</h3>
      ${staff.map((c) => `<div class="line"><span>${esc(s.people[c.personId].name)} · ${esc(c.title)} · ${fmtMoney(c.wage)}/h</span><span>perf ${c.performance} <button data-dismiss="${c.id}">Let go</button></span></div>`).join('') || '<p class="muted">No employees.</p>'}
      ${b.positions.map((pos) => `<div class="card"><b>${esc(pos.title)}</b> · ${fmtMoney(pos.wage)}/h · ${pos.shifts.map(shiftLabel).join('; ')}<br><span class="muted">${esc(pos.description)}</span>
        <div class="row">Positions: <button data-staff="${pos.id}" data-n="${pos.headcount - 1}">−</button><b>${pos.headcount}</b><button data-staff="${pos.id}" data-n="${pos.headcount + 1}">+</button>
        ${pos.id === 'assistant' ? Object.entries(E.SHIFT_PRESETS).map(([k, sp]) => `<button data-shift="${k}">${sp.label.replace('Mon-Sat ', '')}</button>`).join('') : ''}</div></div>`).join('')}
      <p class="muted">A manager reorders stock every day at 16:00. Without one, you order yourself.</p>
      ${apps.length ? `<h3>Applicants</h3>${apps.map((a) => { const ap = s.people[a.personId]; const pos = b.positions.find((x) => x.id === s.vacancies[a.vacancyId].positionId)!; return `<div class="card"><b>${esc(ap.name)}</b> for ${esc(pos.title)} · score ${a.score}<br><span class="muted">retail lvl ${skillLevel(ap.skills.retail ?? 0)} · reputation ${ap.reputation.toFixed(0)} · reliability ${Math.round(ap.traits.conscientiousness * 100)}%</span><div class="row"><button class="primary" data-hire="${a.id}">Hire</button><button data-reject="${a.id}">Turn down</button></div></div>`; }).join('')}` : ''}`;
  }

  onPhoneClick(e: Event) {
    const t = e.target as HTMLElement;
    const btn = t.closest('button');
    if (!btn) return;
    const d = btn.dataset;
    const s = this.s;
    if (d.tab) { this.tab = d.tab as Tab; if (d.tab === 'jobs') s.flags.viewedJobs = true; this.renderPhone(); return; }
    if (d.close) return this.closePhone();
    if (d.ae) { const r = goToAandE(s, this.p.id); this.toast(r.msg); if (r.ok) this.closePhone(); return; }
    if (d.apply) { this.toast(applyForJob(s, this.p.id, d.apply, []).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.accept) this.toast(acceptOffer(s, d.accept).msg);
    if (d.decline) declineOffer(s, d.decline);
    if (d.promote) this.toast(acceptPromotion(s, d.promote).msg);
    if (d.resign) { if (btn.dataset.confirm) { resign(s, this.p.id); this.toast('You resigned.'); } else { btn.dataset.confirm = '1'; btn.textContent = 'Click again to confirm resignation'; return; } }
    if (d.rerent) this.toast(reRent(s, this.p.id, d.rerent).msg);
    if (d.found) { const name = (document.getElementById('biz-name') as HTMLInputElement | null)?.value ?? ''; this.toast(E.startBusiness(s, name, Number(d.found)).msg); }
    if (d.till) this.toast(E.buyTill(s).msg);
    if (d.price) { const b = E.playerBusiness(s)!; this.toast(E.setPrice(s, d.price, b.prices[d.price] * (1 + Number(d.d))).msg); }
    if (d.order) this.toast(E.orderStock(s, { [d.order]: ITEMS[d.order].caseSize * Number(d.q) }).msg);
    if (d.invest) this.toast(E.invest(s, Number(d.invest)).msg);
    if (d.withdraw) this.toast(E.withdraw(s, Number(d.withdraw)).msg);
    if (d.buyhome) { this.toast(buyHomeProperty(s, this.p.id).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.sellhome) { if (btn.dataset.confirm) { this.toast(sellHome(s, this.p.id).msg); this.lastBody = ''; this.renderPhone(); } else { btn.dataset.confirm = '1'; btn.textContent = 'Click again to confirm the sale'; } return; }
    if (d.msg) { this.closePhone(); this.openChat(d.msg, true); return; }
    if (d.reply) {
      const msg = s.inbox?.find((x) => x.from === d.reply && String(x.at) === d.at);
      if (msg) { msg.read = true; this.openers.set(d.reply, msg.text); }
      this.closePhone(); this.openChat(d.reply, true); return;
    }
    if (d.invite) { this.toast(inviteForCoffee(s, this.p.id, d.invite).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.loan) { this.toast(takeLoan(s, this.p.id, Number(d.loan)).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.stakebuy) { this.toast(buyStake(s, this.p.id, d.stakebuy).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.enrol) { this.toast(enrol(s, this.p.id, d.enrol).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.retest) { this.toast(bookRetest(s, this.p.id).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.letbuy) { this.toast(buyNewBuild(s, this.p.id, d.letbuy).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.letsell) { this.toast(sellNewBuild(s, this.p.id, d.letsell).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.carbuy) { const [m, c] = d.carbuy.split('|'); this.toast(buyCar(s, this.p.id, m, c).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.carsell) { this.toast(sellCar(s, this.p.id).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.buyout) { this.toast(buyOut(s, this.p.id, d.buyout).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.stakesell) { this.toast(sellStake(s, this.p.id, d.stakesell).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.loanrepay) { this.toast(repayLoan(s, d.loanrepay).msg); this.lastBody = ''; this.renderPhone(); return; }
    if (d.homeBuy) {
      if (this.homeDraft) { const r = buyHome(s, this.p.id, this.homeDraft, d.homeBuy === 'counter'); this.toast(r.msg); if (r.ok) this.homeDraft = null; }
      this.lastBody = ''; this.renderPhone(); return;
    }
    if (d.homeReset) { this.homeDraft = null; this.lastBody = ''; this.renderPhone(); return; }
    if (d.homeRearrange) { this.changeHome((h) => { h.seed = (h.seed * 48271 + 11) % 100003 || 7; }); this.toast('The furniture has been moved around.'); return; }
    if (d.closed) this.toast(E.setClosed(s, d.closed === '1').msg);
    if (d.nightfill) this.toast(E.setNightFill(s, d.nightfill === '1').msg);
    if (d.hours) this.toast(E.setHours(s, d.hours).msg);
    if (d.staff) this.toast(E.setStaffing(s, d.staff, Number(d.n)).msg);
    if (d.shift) { const b = E.playerBusiness(s)!; const pos = b.positions.find((x) => x.id === 'assistant')!; this.toast(E.setStaffing(s, 'assistant', pos.headcount, d.shift).msg); }
    if (d.hire) this.toast(E.hireApplicant(s, d.hire).msg);
    if (d.reject) this.toast(E.rejectApplicant(s, d.reject).msg);
    if (d.dismiss) this.toast(E.dismissStaff(s, d.dismiss).msg);
    this.lastBody = '';
    this.renderPhone();
  }

  // ------------------------------------------------------------ conversations
  /** talk to someone: topic buttons always; with an AI key, type anything and they answer in character */
  /** opening lines people stopped you with in the street (said before you answered) */
  private openers = new Map<string, string>();

  /** talk to someone, face to face or (remote) by text on your phone. Needs the player's OpenAI key */
  openChat(npcId: string, remote = false) {
    const s = this.s, me = this.p, o = s.people[npcId];
    if (!o) return;
    if (!hasAi()) { this.toast('To talk to people, add your OpenAI API key (Menu > AI conversations).'); return; }
    const hold = () => {
      if (remote) return;
      o.move = null;
      if (o.npc) { o.npc.plan = o.npc.plan.filter((x) => x.kind !== 'wait'); o.npc.plan.unshift({ kind: 'wait', until: s.minute + 4 }); }
      o.facing = Math.atan2(me.pos.x - o.pos.x, me.pos.z - o.pos.z);
      me.facing = Math.atan2(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      this.game.frameTalk(npcId);
    };
    hold();
    beginTalk(s, npcId);
    const log: { who: 'you' | 'them' | 'fact'; text: string }[] = [];
    const history: ChatTurn[] = [{ role: 'system', content: characterBrief(s, npcId, remote) }];
    const said: string[] = [];
    let busy = false, ended = false, lastSend = 0, exchanges = 0;
    const first = o.name.split(' ')[0];
    const say = (who: 'you' | 'them' | 'fact', text: string) => {
      log.push({ who, text });
      if (!remote && who === 'them') this.game.say(npcId, text, Math.min(9, 3 + text.length / 18));
      if (!remote && who === 'you') { this.game.say(me.id, text, Math.min(7, 2 + text.length / 20)); gesture(s, me, 'talk', 2); }
    };
    const finish = () => {
      if (ended) return;
      ended = true;
      this.closeDialog();
      $('#dialog').classList.remove('chatmode');
      if (!remote) this.game.frameTalk(null);
      if (o.npc) o.npc.plan = o.npc.plan.filter((x) => x.kind !== 'wait');
      // they remember the conversation: one line, in their own words
      if (exchanges > 0) {
        const transcript = log.map((l) => `${l.who === 'you' ? me.name.split(' ')[0] : l.who === 'them' ? first : '*'}: ${l.text}`).join('\n');
        aiJson([{ role: 'system', content: `You are ${o.name}. In ONE short sentence, in the first person, note what you will remember about ${me.name.split(' ')[0]} from this conversation (what they said, asked, how they behaved, how you felt). Reply as JSON {"note": "..."}.` }, { role: 'user', content: transcript }], 80).then((r) => { if ('data' in r) remember(s, npcId, String((r.data as any)?.note ?? '').slice(0, 220)); });
      }
    };
    const ask = async (content: string) => {
      history.push({ role: 'user', content });
      busy = true; render();
      const r = await aiJson(history);
      busy = false;
      if (ended) return;
      if ('error' in r) { say('fact', r.error); this.toast(r.error); render(); return; }
      const turn = parseTurn(r.data);
      history.push({ role: 'assistant', content: JSON.stringify(r.data) });
      exchanges++;
      hold();
      if (turn.reply) say('them', turn.reply);
      const fact = applyTurn(s, npcId, turn, remote);
      if (fact) { say('fact', fact); this.toast(fact); }
      render();
      if (turn.action === 'leave' || turn.action === 'attack') setTimeout(finish, 1800);
      else setTimeout(() => ($('#chat-in') as HTMLInputElement | null)?.focus(), 0);
    };
    const render = () => {
      if (ended) return;
      const q = personaOf(s, npcId);
      const k = o.knowsYou;
      this.dialog(`<h2>${esc(o.name)}${remote ? ' <span class="muted">(messages)</span>' : ''}</h2><p class="muted">${q.age} · ${esc(q.job)} · ${esc(q.relationToYou)} (${q.relationScore})${k && k.talks > 1 ? ` · talked ${k.talks} times` : ''}</p>
        <div class="card chatlog" style="max-height:42vh;overflow:auto">${log.map((l) => l.who === 'fact' ? `<p class="muted"><i>${esc(l.text)}</i></p>` : `<p><b>${l.who === 'you' ? 'You' : esc(first)}:</b> ${esc(l.text)}</p>`).join('')}${busy ? `<p class="muted">${esc(first)} ${remote ? 'is typing' : 'is answering'}…</p>` : ''}</div>
        <div class="row"><input id="chat-in" type="text" maxlength="300" placeholder="${remote ? 'Message' : 'Say'} anything to ${esc(first)}…" style="flex:1" autocomplete="off"><button class="primary" data-send="1" ${busy ? 'disabled' : ''}>${remote ? 'Send' : 'Say'}</button></div>
        <div class="row"><button data-bye="1">${remote ? 'Close' : 'Walk away'}</button></div>`, (btn) => {
        btn.blur();
        if (btn.dataset.bye) { finish(); return; }
        if (busy) return;
        const inp = $('#chat-in') as HTMLInputElement | null;
        const text = inp?.value.trim() ?? '';
        if (!text) return;
        const now = performance.now();
        const notes = speechNotes(text, said, lastSend ? now - lastSend : 99999);
        lastSend = now;
        said.push(text);
        say('you', text);
        void ask(notes.length ? `${text}\n\n[What you notice: ${notes.join('; ')}]` : text);
      });
      // the conversation happens in real time, in the world: the panel sits low so you can watch them
      $('#dialog').classList.add('chatmode');
      this.liveDialog = true;
      this.syncModal();
      const log$ = document.querySelector('#dialog .chatlog');
      if (log$) log$.scrollTop = log$.scrollHeight;
      const inp = $('#chat-in') as HTMLInputElement | null;
      if (inp) inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') ($('#dialog [data-send]') as HTMLButtonElement | null)?.click(); };
    };
    const opener = this.openers.get(npcId);
    this.openers.delete(npcId);
    if (opener) { log.push({ who: 'them', text: opener }); history.push({ role: 'assistant', content: JSON.stringify({ reply: opener, emotion: 'neutral', attitude: 0, decision: null, action: 'none' }) }); render(); setTimeout(() => ($('#chat-in') as HTMLInputElement | null)?.focus(), 0); }
    else void ask(remote ? `[${me.name.split(' ')[0]} has sent you a message to start a conversation. Reply to open it.]` : `[${me.name.split(' ')[0]} has walked up to you and wants to talk. They have not said anything yet. React as you naturally would.]`);
  }

  private nextText = performance.now() + 90000;
  /** friends with your number text you now and then: about their lives, gossip, to meet up */
  private texting() {
    const now = performance.now();
    if (now < this.nextText || !hasAi()) return;
    this.nextText = now + 75000;
    const s = this.s, me = this.p;
    if (me.away || me.dead || me.sleeping) return;
    const cands = Object.values(s.people).filter((o) => !o.isPlayer && !o.dead && !o.left && !o.away && !o.sleeping && o.knowsYou?.number && (o.relations[me.id] ?? 0) >= 15);
    if (!cands.length) return;
    const o = cands[Math.floor(Math.random() * cands.length)];
    const last = (s.inbox ?? []).filter((x) => x.from === o.id).pop();
    const close = (o.relations[me.id] ?? 0) / 100 + (me.partnerId === o.id ? 0.5 : 0);
    if (Math.random() > 0.25 + close * 0.5 || (last && s.minute - last.at < 180)) return;
    void aiJson([{ role: 'system', content: characterBrief(s, o.id, true) }, { role: 'user', content: `[You decide to text ${me.name.split(' ')[0]} out of the blue. Write the text message you send, in character: maybe about something going on in your life, some gossip, asking how they are or to meet up, or about something that happened between you. Keep it short, like a real text.]` }], 120).then((r) => {
      if (!('data' in r)) return;
      const t = parseTurn(r.data);
      if (!t.reply) return;
      (s.inbox ??= []).push({ from: o.id, text: t.reply, at: s.minute, read: false });
      if (s.inbox.length > 40) s.inbox.splice(0, s.inbox.length - 40);
      this.toast(`Message from ${o.name.split(' ')[0]}: "${t.reply.slice(0, 80)}${t.reply.length > 80 ? '…' : ''}" (Phone > People)`);
    });
  }

  private rowHeard = -1;
  /** a row in the street: what they shout at each other comes from who they are */
  private rowWords() {
    const inc = this.s.incident;
    if (!inc || inc.stage !== 'argue' || this.rowHeard === inc.at || !hasAi()) return;
    this.rowHeard = inc.at;
    void this.ambientChat(inc.a, inc.b, `They are having a heated, angry argument in the street (${inc.why}). Raised voices, short sharp lines, British swearing kept mild.`);
  }
  private doorSpoken = -1;
  /** whoever answers a door you knocked on says something (in their own words, with a key) */
  private doorWords() {
    const c = this.s.doorCall;
    if (!c || c.stage !== 'open' || !c.answerer || this.doorSpoken === c.at || !hasAi()) return;
    this.doorSpoken = c.at;
    const id = c.answerer, me = this.p.name.split(' ')[0];
    void aiJson([{ role: 'system', content: characterBrief(this.s, id) }, { role: 'user', content: `[${me} knocked on your front door and you have just opened it. ${c.letIn ? 'You are happy to let them in.' : 'You are NOT letting them in, and are about to close the door.'} Say what you say at the door.]` }]).then((r) => {
      if (!('data' in r)) return;
      const t = parseTurn(r.data);
      if (t.reply) this.game.say(id, t.reply, 5);
    });
  }

  /** someone has stopped you in the street: what they say first comes from who they are */
  async approached(npcId: string) {
    const s = this.s, o = s.people[npcId];
    if (!o) return;
    if (!hasAi()) { gesture(s, o, 'wave', 2.2); return; }
    gesture(s, o, 'wave', 2.2);
    const r = await aiJson([{ role: 'system', content: characterBrief(s, npcId) }, { role: 'user', content: `[You have stopped ${this.p.name.split(' ')[0]} in the street because you want to talk to them. Say your opening line.]` }]);
    if (!('data' in r)) return;
    const t = parseTurn(r.data);
    if (!t.reply) return;
    this.openers.set(npcId, t.reply);
    this.game.say(npcId, t.reply, 6);
    this.toast(`${o.name}: "${t.reply}" (E to talk)`);
  }

  /** two townspeople chatting nearby: their exchange is written from who they both are */
  async ambientChat(aId: string, bId: string, context = '') {
    const s = this.s, a = s.people[aId], b = s.people[bId];
    if (!a || !b || !hasAi()) return;
    const qa = personaOf(s, aId), qb = personaOf(s, bId);
    const brief = (q: typeof qa) => `${q.name}, ${q.age}, ${q.job}; ${q.personality.slice(0, 3).join(', ')}; ${q.mood}; family: ${q.family}; recently: ${q.recent.slice(-2).join('; ') || 'nothing much'}`;
    const r = await aiJson([{ role: 'system', content: `Write a short, natural exchange (3 or 4 lines, each under 15 words) between two people chatting in Harbourside, a small British harbour town, ${qa.time}, ${qa.weather}. They talk about their own lives, people they know, work or the town, in character. A: ${brief(qa)}. B: ${brief(qb)}. How well they know each other: ${Math.round(a.relations[bId] ?? 0)}/100.${a.partnerId === bId ? ` They are ${a.relationship === 'married' ? 'married' : 'a couple'}.` : ''}${context ? ` ${context}` : ''} Reply as JSON {"lines": [{"who": "A" or "B", "text": "..."}]}.` }], 200);
    if (!('data' in r)) return;
    const lines = ((r.data as any)?.lines ?? []).slice(0, 4);
    lines.forEach((l: any, i: number) => setTimeout(() => {
      const id = l.who === 'B' ? bId : aId;
      const p = s.people[id];
      if (!p?.visible) return;
      this.game.say(id, String(l.text ?? '').slice(0, 140), 4);
      gesture(s, p, 'talk', 3);
    }, i * 3600));
  }

  // ------------------------------------------------------------ dialogs
  dialog(html: string, onClick: (btn: HTMLButtonElement) => void) {
    const dlg = $('#dialog');
    dlg.innerHTML = html;
    dlg.hidden = false;
    dlg.onclick = (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) onClick(b as HTMLButtonElement); };
    this.syncModal();
  }
  closeDialog() { $('#dialog').hidden = true; this.liveDialog = false; this.syncModal(); }

  /** the in-person interview, started by talking to the interviewer at the workplace */
  interviewInPerson(appId: string) {
    const s = this.s;
    const a = s.applications[appId];
    const v = s.vacancies[a.vacancyId];
    const b = s.businesses[v.businessId];
    const iv = s.people[a.interviewerId!];
    const pos = b.positions.find((x) => x.id === v.positionId)!;
    const answers: number[] = [];
    // sit down at the table; the conversation happens in real time (the clock keeps running)
    startAction(s, 'player', 'iv_chair', 'sit');
    this.liveDialog = true;
    const stand = () => { const p = s.people.player; if (p.action?.type === 'sit' && p.action.target === 'iv_chair') cancelAction(s, p, 'interview over'); };
    const qs = questionsFor(a);
    const ask = () => {
      const qi = answers.length;
      if (qi >= qs.length) {
        const r = attendInterview(s, appId, answers);
        this.game.say(iv.id, r.offered ? 'We would like you to join us.' : 'Thanks for coming in.', 6);
        this.dialog(`<div class="dlg"><h2>${r.offered ? 'Job offered' : 'Not this time'}</h2><p>${esc(iv.name)}: ${r.offered ? '"We would like you to join us."' : '"Thanks for coming in. We have decided not to go ahead."'}</p>
          <p class="muted">Interview score ${r.score}</p><ul>${r.feedback.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="row">${r.offered ? `<button class="primary" data-acc="1">Accept the job</button><button data-later="1">Think about it (24h)</button>` : '<button data-later="1">Leave</button>'}</div></div>`, (btn) => {
          if (btn.dataset.acc) this.toast(acceptOffer(s, appId).msg);
          stand();
          this.closeDialog();
        });
        return;
      }
      const Q = qs[qi];
      this.game.say(iv.id, Q.q, 30);
      this.liveDialog = true;
      this.dialog(`<div class="dlg"><h2>Interview: ${esc(pos.title)}</h2><p class="muted">${esc(b.name)} · with ${esc(iv.name)} · question ${qi + 1} of ${qs.length}</p><p><b>${esc(iv.name.split(' ')[0])}:</b> "${esc(Q.q)}"</p>${Q.a.map((x, i) => `<button class="answer" data-a="${i}">${esc(x)}</button>`).join('')}</div>`, (btn) => {
        if (btn.dataset.a === undefined) return;
        answers.push(Number(btn.dataset.a));
        ask();
      });
    };
    ask();
  }

  interview(vacancyId: string) {
    const s = this.s;
    const v = s.vacancies[vacancyId];
    const b = s.businesses[v.businessId];
    const pos = b.positions.find((x) => x.id === v.positionId)!;
    const answers: number[] = [];
    const render = () => {
      const qi = answers.length;
      if (qi >= INTERVIEW.length) {
        const r = applyForJob(s, this.p.id, vacancyId, answers);
        this.toast(r.msg);
        this.closeDialog();
        this.renderPhone();
        return;
      }
      const Q = INTERVIEW[qi];
      this.dialog(`<h2>Application: ${esc(pos.title)}</h2><p class="muted">${esc(b.name)} · question ${qi + 1} of ${INTERVIEW.length}</p><p><b>${esc(Q.q)}</b></p>${Q.a.map((a, i) => `<button class="answer" data-a="${i}">${esc(a)}</button>`).join('')}<div class="row"><button data-cancel="1">Cancel</button></div>`, (btn) => {
        if (btn.dataset.cancel) return this.closeDialog();
        answers.push(Number(btn.dataset.a));
        render();
      });
    };
    render();
  }

  advisor() {
    const s = this.s, p = this.p;
    const open = Object.values(s.vacancies).filter((v) => v.status === 'open');
    const playable = open.filter((v) => s.businesses[v.businessId].positions.find((x) => x.id === v.positionId)?.playable);
    const ruthHere = openAttendance(s, 'p_ruth');
    const lines = [
      ruthHere ? `"Hello ${esc(p.name.split(' ')[0])}, I'm Ruth. Let's see what's out there."` : '"(The advisor desk is unstaffed right now. Open Monday to Friday, 09:00 to 17:00. The vacancy board still works.)"',
      playable.length ? `There ${playable.length === 1 ? 'is' : 'are'} ${playable.length} vacanc${playable.length === 1 ? 'y' : 'ies'} you could do right now: ${playable.map((v) => esc(s.businesses[v.businessId].positions.find((x) => x.id === v.positionId)!.title + ' at ' + s.businesses[v.businessId].name)).join(', ')}.` : 'No suitable vacancies are open right now. Employers advertise when they are short-staffed, so check back daily.',
      'Tips: employers like punctual people who put customers first. Your answers in the application questions matter, and so does your reputation from past jobs.',
      `Your rent is ${fmtMoney(activeLease(s, p.id)?.weeklyRent ?? 0)} a week, collected on Mondays at 09:00. Keep at least that much in your account.`,
    ];
    this.dialog(`<h2>Employment advisor</h2>${lines.map((l) => `<p>${l}</p>`).join('')}<div class="row"><button class="primary" data-jobs="1">Open vacancies</button><button data-cancel="1">Close</button></div>`, (btn) => {
      this.closeDialog();
      if (btn.dataset.jobs) this.openPhone('jobs');
    });
  }

  // ------------------------------------------------------------ menu
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    $('#menu').hidden = !this.menuOpen;
    if (this.menuOpen) this.renderMenu();
    this.syncModal();
  }
  renderMenu(msg = '') {
    const slot = localStorageGet('bigshot.slot1');
    const auto = localStorageGet('bigshot.auto');
    const sum = (t: string | null) => { try { return t ? JSON.parse(t).summary : 'empty'; } catch { return 'unreadable'; } };
    $('#menu-body').innerHTML = `<h2>Paused</h2>${msg ? `<p class="${msg.startsWith('Saved') || msg.startsWith('Loaded') ? 'pos' : 'warn'}">${esc(msg)}</p>` : ''}
      <button class="primary" data-m="resume">Resume</button>
      <button data-m="save">Save game <span class="muted">(${esc(sum(slot))})</span></button>
      <button data-m="load">Load saved game</button>
      <button data-m="loadauto">Load autosave <span class="muted">(${esc(sum(auto))})</span></button>
      <button data-m="new">New game</button>
      <button data-m="sound">Sound: ${this.game.audio.muted ? 'Off' : 'On'} - click to switch</button>
      <button data-m="gfx">Graphics: ${this.game.quality === 'high' ? 'High (ambient occlusion, bloom, anti-aliasing)' : this.game.quality === 'medium' ? 'Medium (anti-aliasing, no ambient occlusion)' : 'Low (fastest)'} · resolution ${Math.round(this.game.resScale * 100)}% - click to switch</button>
      <h3>AI conversations (optional)</h3><p class="muted">With your own OpenAI API key, people answer anything you say, in character, from their job, family, money, mood and history. The key is kept only in this browser and sent only to OpenAI. Without a key, conversations use built-in replies.</p>
      ${hasAi() ? `<p>Key saved (…${esc((getApiKey() ?? '').slice(-4))}) · model ${esc(getModel())}</p><div class="row"><button data-m="aiclear">Remove key</button></div>` : `<input id="ai-key" type="password" placeholder="sk-…" autocomplete="off" style="font:inherit;padding:8px;border-radius:6px;border:1px solid var(--line);background:#1c2420;color:var(--ink)"><div class="row"><button data-m="aisave">Save key</button></div>`}
      <h3>Controls</h3><p class="muted">WASD or arrows: walk in that direction (relative to the camera) · Shift: run · E: use · F: punch / attack · Q: hold a weapon (bat or knife, sold at Harbour Home) · G: take a car from the traffic · 1-6: other options · Tab or P: phone · Esc: pause. The camera follows you automatically; drag to look around, scroll to zoom.</p>
      <p class="muted">Day ${dayIndex(this.s.minute) + 1}. Time passes at ${this.game.speedMult}× (1× = 20 game minutes per real minute). Sleeping fast-forwards.</p>`;
  }
  onMenuClick(e: Event) {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const m = b.dataset.m;
    if (m === 'resume') return this.toggleMenu();
    if (m === 'save') { const r = this.game.save(); this.renderMenu(r.ok ? 'Saved.' : r.error ?? 'Save failed'); }
    if (m === 'load' || m === 'loadauto') { const r = this.game.load(m === 'load' ? 'bigshot.slot1' : 'bigshot.auto'); this.renderMenu(r.ok ? 'Loaded.' : (r as any).error); }
    if (m === 'sound') { const a = this.game.audio; a.muted = !a.muted; try { localStorage.setItem('bigshot.sound', a.muted ? 'off' : 'on'); } catch { /* */ } a.start(); this.renderMenu(); return; }
    if (m === 'aisave') { const k = ($('#ai-key') as HTMLInputElement)?.value.trim(); if (k) setApiKey(k); this.renderMenu(k ? 'AI key saved. Talk to anyone to try it.' : 'Paste a key first.'); return; }
    if (m === 'aiclear') { setApiKey(null); this.renderMenu('AI key removed.'); return; }
    if (m === 'gfx') { this.game.setQuality(this.game.quality === 'high' ? 'medium' : this.game.quality === 'medium' ? 'low' : 'high'); this.renderMenu(); return; }
    if (m === 'new') { if (b.dataset.confirm) location.reload(); else { b.dataset.confirm = '1'; b.textContent = 'Click again: unsaved progress will be lost'; } }
  }
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }

const ROLE_LABEL: Record<string, string> = { manager: 'Manager', cashier: 'Cashier: till first', stocker: 'Stacker: stock room & shelves', cleaner: 'Cleaner: spills & floor rounds' };

function setBar(sel: string, v: number) {
  const el = document.querySelector(sel) as HTMLElement;
  el.style.width = `${v}%`;
  el.classList.toggle('low', v < 25);
}

const ACTION_LABELS: Record<string, string> = {
  clock_in: 'Clocking in…', clock_out: 'Clocking out…', take_case: 'Picking up a case…', return_case: 'Returning stock…', stock_shelf: 'Stocking the shelf…',
  serve_customer: 'Scanning items…', self_checkout: 'Scanning and paying…', take_mop: 'Getting the mop…', return_mop: 'Putting the mop away…', clean: 'Mopping…',
  check_in_delivery: 'Counting the delivery in…', pick_item: 'Taking item…', sleep: 'Sleeping… (time is fast-forwarding)', eat: 'Eating…', store_food: 'Putting shopping away…',
  change_outfit: 'Changing clothes…', buy_meal: 'Eating a cafe meal…', sit: 'Sitting (resting slowly)',
  shower: 'Showering…', cook: 'Cooking…', watch_tv: 'Watching TV', talk: 'Chatting…',
  face_shelf: 'Facing up: pulling packs forward, labels out…', bale_cardboard: 'Flattening boxes into the baler…', empty_bin: 'Tying off the bin bag…', dump_rubbish: 'Throwing the bag in…',
  take_order: 'Talking the order through…', take_tool: 'Getting the tool…', return_tool: 'Putting the tool away…', take_bricks: 'Loading up with bricks…', site_work: 'Working on the house…', cook_meal: 'Cooking on the grill…', serve_meal: 'Handing over the meal…', drive_van: 'Getting in…', drive_car: 'Getting in…', drive_forklift: 'Climbing on…', study: 'In class…', buy_stall: 'Buying…', pick_case: 'Picking from the racking…', stage_case: 'Staging cases for dispatch…', wash_up: 'Washing up…', laundry: 'Doing the laundry…', tidy: 'Tidying up…',
};
const TASK_LABELS: Record<string, [string, string]> = {
  restock: ['restock', 'restocks'], serve: ['customer to serve', 'customers to serve'], clean: ['spill', 'spills'], receive: ['delivery', 'deliveries'],
  pick: ['order line to pick', 'order lines to pick'], face: ['shelf to face up', 'shelves to face up'], cardboard: ['cardboard to bale', 'cardboard to bale'], rubbish: ['bin to empty', 'bins to empty'],
};
const actionLabel = (t: string) => ACTION_LABELS[t] ?? t;
