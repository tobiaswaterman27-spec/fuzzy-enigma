// TransactionSystem / AccountingSystem.
// Every change of money goes through transfer(). Balances are always
// reproducible as archived opening + sum(transactions).
import type { Account, AccountKind, Cents, GameState, Id, Txn, TxnReason } from './types';
import { nextId } from './core';

export function openAccount(
  state: GameState,
  ownerId: Id,
  name: string,
  kind: AccountKind,
  allowNegative = false,
): Account {
  const id = nextId(state, 'acc');
  const acc: Account = { id, ownerId, name, kind, balance: 0, allowNegative };
  state.ledger.accounts[id] = acc;
  state.ledger.archived[id] = 0;
  return acc;
}

export interface TransferReq {
  from: Id;
  to: Id;
  amount: Cents;
  reason: TxnReason;
  memo: string;
  ref?: Id;
  /** idempotency key: a transfer with a key that was already applied is rejected */
  key?: string;
}

export type TransferResult = { ok: true; txn: Txn } | { ok: false; error: string };

export function transfer(state: GameState, req: TransferReq): TransferResult {
  const L = state.ledger;
  if (!Number.isInteger(req.amount) || req.amount <= 0) return { ok: false, error: 'Amount must be a positive whole number of cents' };
  if (req.key && L.keys[req.key]) return { ok: false, error: `Duplicate transfer ${req.key}` };
  const from = L.accounts[req.from];
  const to = L.accounts[req.to];
  if (!from || !to) return { ok: false, error: 'Unknown account' };
  if (from.id === to.id) return { ok: false, error: 'Cannot transfer to the same account' };
  if (!from.allowNegative && from.balance < req.amount) return { ok: false, error: 'Insufficient funds' };
  // apply atomically
  from.balance -= req.amount;
  to.balance += req.amount;
  const txn: Txn = {
    id: nextId(state, 'txn'),
    time: state.minute,
    from: from.id,
    to: to.id,
    amount: req.amount,
    reason: req.reason,
    memo: req.memo,
    ref: req.ref,
  };
  L.txns.push(txn);
  if (req.key) L.keys[req.key] = true;
  return { ok: true, txn };
}

export function balance(state: GameState, accountId: Id): Cents {
  return state.ledger.accounts[accountId]?.balance ?? 0;
}

/** Recompute every balance from archived openings + transactions; returns mismatching account ids. */
export function auditLedger(state: GameState): Id[] {
  const L = state.ledger;
  const sums: Record<Id, number> = { ...L.archived };
  for (const t of L.txns) {
    sums[t.from] = (sums[t.from] ?? 0) - t.amount;
    sums[t.to] = (sums[t.to] ?? 0) + t.amount;
  }
  const bad: Id[] = [];
  for (const acc of Object.values(L.accounts)) {
    if ((sums[acc.id] ?? 0) !== acc.balance) bad.push(acc.id);
    if (!acc.allowNegative && acc.balance < 0) bad.push(acc.id);
  }
  return bad;
}

/** total money in the system; must be zero-sum including external/aggregate accounts */
export function moneySupply(state: GameState): Cents {
  return Object.values(state.ledger.accounts).reduce((s, a) => s + a.balance, 0);
}

/** Archive transactions older than `keepMinutes` into per-account opening balances (keeps saves small). */
export function compactLedger(state: GameState, keepMinutes: number): number {
  const L = state.ledger;
  const cutoff = state.minute - keepMinutes;
  let n = 0;
  const keep: Txn[] = [];
  for (const t of L.txns) {
    if (t.time < cutoff) {
      L.archived[t.from] = (L.archived[t.from] ?? 0) - t.amount;
      L.archived[t.to] = (L.archived[t.to] ?? 0) + t.amount;
      n++;
    } else keep.push(t);
  }
  L.txns = keep;
  return n;
}

export function accountTxns(state: GameState, accountId: Id, limit = 50): Txn[] {
  const out: Txn[] = [];
  for (let i = state.ledger.txns.length - 1; i >= 0 && out.length < limit; i--) {
    const t = state.ledger.txns[i];
    if (t.from === accountId || t.to === accountId) out.push(t);
  }
  return out;
}
