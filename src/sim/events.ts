// EventAndNewsSystem: notifications and news are only ever created by the
// system that caused the change, so headlines always reflect real state.
import type { GameState, LifeEvent, NewsKind, Person } from './types';
import { nextId } from './core';

export function news(state: GameState, kind: NewsKind, title: string, body = '', personal = false) {
  state.news.unshift({ id: nextId(state, 'news'), time: state.minute, kind, title, body, personal, read: false });
  if (state.news.length > 150) state.news.length = 150;
}

export function lifeEvent(state: GameState, p: Person, text: string) {
  const e: LifeEvent = { time: state.minute, text };
  p.history.push(e);
  if (p.history.length > 80) p.history.splice(0, p.history.length - 80);
}

export function npcLog(state: GameState, p: Person, text: string) {
  if (!p.npc) return;
  p.npc.log.push(`${Math.floor(state.minute)} ${text}`);
  if (p.npc.log.length > 12) p.npc.log.shift();
}
