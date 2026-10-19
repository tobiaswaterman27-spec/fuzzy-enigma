// Authoritative simulation state for THE BIGSHOT.
// Everything in GameState is plain JSON so it can be saved, validated and
// restored without bespoke serialisers. Static world geometry lives in
// world/layout.ts and is rebuilt from code rather than saved.

export type Id = string;
export type Cents = number; // all money is stored as integer cents

export interface Vec2 {
  x: number;
  z: number;
}

// ---------------------------------------------------------------- ledger
export type AccountKind = 'person' | 'business' | 'government' | 'external' | 'aggregate';

export interface Account {
  id: Id;
  ownerId: Id;
  name: string;
  kind: AccountKind;
  balance: Cents;
  /** External/aggregate boundary accounts may go negative; people and firms may not. */
  allowNegative: boolean;
}

export type TxnReason =
  | 'opening_balance'
  | 'wage'
  | 'income_tax'
  | 'sale'
  | 'sales_tax'
  | 'purchase'
  | 'supplier_invoice'
  | 'import'
  | 'rent'
  | 'late_fee'
  | 'utilities'
  | 'deposit'
  | 'aggregate_income'
  | 'public_service'
  | 'owner_draw'
  | 'services'
  | 'loan'
  | 'loan_repayment'
  | 'property'
  | 'transfer';

export interface Txn {
  id: Id;
  time: number; // game minute
  from: Id;
  to: Id;
  amount: Cents;
  reason: TxnReason;
  memo: string;
  ref?: Id;
}

export interface LedgerState {
  accounts: Record<Id, Account>;
  txns: Txn[];
  /** idempotency keys of transfers already applied */
  keys: Record<string, true>;
  /** balances carried forward from compacted (archived) transactions, per account */
  archived: Record<Id, Cents>;
}

// ------------------------------------------------------------- inventory
export type ContainerKind =
  | 'shelf'
  | 'backroom'
  | 'hands'
  | 'basket'
  | 'pantry'
  | 'bag'
  | 'wardrobe'
  | 'van'
  | 'loading_bay'
  | 'warehouse'
  | 'cupboard'
  | 'supplies';

export interface Container {
  id: Id;
  kind: ContainerKind;
  ownerId: Id;
  locationId: Id;
  capacity: number; // total units, Infinity not allowed in JSON so use large numbers
  /** if set, only this item type can be stored */
  filter?: string;
  items: Record<string, number>;
}

// ------------------------------------------------------------- people
export type HairStyle = 'short' | 'long' | 'bun' | 'bald' | 'curly';
export type Build = 'slim' | 'average' | 'broad';

export interface Appearance {
  skin: string;
  hair: HairStyle;
  hairColor: string;
  build: Build;
  height: number; // scale factor ~0.92 - 1.08
  outfit: string; // item id of equipped outfit
  frame?: 'm' | 'f'; // body frame
}

export interface Needs {
  energy: number; // 0..100
  satiety: number; // 0..100 (100 = full)
  hygiene: number; // 0..100 (shower restores)
  mood: number; // 0..100 (leisure, food, company raise it)
}

export interface Traits {
  conscientiousness: number; // 0..1
  sociability: number;
  ambition: number;
  patience: number;
  thrift: number;
}

export interface LifeEvent {
  time: number;
  text: string;
}

export type ActionType =
  | 'clock_in'
  | 'clock_out'
  | 'take_case'
  | 'stock_shelf'
  | 'return_case'
  | 'serve_customer'
  | 'take_mop'
  | 'return_mop'
  | 'clean'
  | 'check_in_delivery'
  | 'pick_item'
  | 'self_checkout'
  | 'sleep'
  | 'eat'
  | 'change_outfit'
  | 'buy_meal'
  | 'store_food'
  | 'shower'
  | 'watch_tv'
  | 'cook'
  | 'talk'
  | 'sit'
  | 'drive_van'
  | 'take_order'
  | 'cook_meal'
  | 'take_tool'
  | 'return_tool'
  | 'take_bricks'
  | 'site_work'
  | 'serve_meal'
  | 'pick_case'
  | 'stage_case'
  | 'face_shelf'
  | 'bale_cardboard'
  | 'empty_bin'
  | 'dump_rubbish'
  | 'wash_up'
  | 'laundry'
  | 'tidy';

export interface ActionState {
  type: ActionType;
  target: Id; // interactable id or entity id
  arg?: string;
  started: number; // game minute
  /** accumulated progress in game minutes */
  progress: number;
  /** for unit-based actions: game minutes per unit */
  unitTime: number;
  /** for fixed actions: total duration */
  duration: number;
  units: number; // units completed so far
}

export type NpcGoal =
  | 'idle_home'
  | 'go_work'
  | 'work'
  | 'go_home'
  | 'sleep'
  | 'shop'
  | 'leisure'
  | 'offsite'
  | 'leave';

export interface MoveState {
  path: Vec2[];
  idx: number;
  dest: Vec2;
  destLabel: string;
  stuckTime: number;
  lastDist: number;
  replans: number;
}

export type PlanStep =
  | { kind: 'move'; to: Vec2; label: string }
  | { kind: 'act'; it: Id; type: ActionType; arg?: string }
  | { kind: 'wait'; until: number }
  | { kind: 'call'; fn: string; arg?: string };

export interface NpcState {
  goal: NpcGoal;
  plan: PlanStep[];
  claim?: Id; // task id this worker has claimed
  homeOutfit: string;
  bedtime: number; // minute of day
  wake: number; // minute of day
  goalSince: number;
  nextDecision: number;
  /** a small plan step machine within the goal */
  step: string;
  stepTarget?: Id;
  /** shopping list for 'shop' goal */
  list?: Record<string, number>;
  patienceUntil?: number;
  queuedAt?: number;
  shopId?: Id; // shop being visited
  queueSlot?: number;
  log: string[];
  ambient?: boolean; // pooled ambient shopper from aggregate population
  retired?: boolean; // not looking for work
  searchFrom?: number; // starts looking for work at this minute
}

export interface Person {
  id: Id;
  name: string;
  isPlayer: boolean;
  appearance: Appearance;
  homeId: Id | null; // location id
  accountId: Id;
  pos: Vec2;
  facing: number; // radians, 0 = +z
  /** building/location id the person is currently in ('outside' when on the street, 'offsite' when away) */
  where: Id;
  visible: boolean;
  needs: Needs;
  skills: Record<string, number>; // xp
  traits: Traits;
  contractId: Id | null;
  handsId: Id; // container
  bagId: Id; // container carried (shopping)
  basketId: Id; // shop basket while shopping
  pantryId: Id | null;
  wardrobeId: Id | null;
  action: ActionState | null;
  move: MoveState | null;
  npc: NpcState | null;
  history: LifeEvent[];
  reputation: number; // professional reputation 0..100
  equipment: string | null; // 'mop' etc held tool
  sleeping: boolean;
  /** familiarity with other people built through conversation and working together (0..100) */
  relations: Record<Id, number>;
  /** home upkeep (player): dirty dishes, untidiness, clothes wear and the washing machine */
  chores?: { dishes: number; mess: number; wear: Record<string, number>; washer: { items: string[]; until: number } | null };
}

// ------------------------------------------------------------- business
export type BusinessKind = 'retail' | 'wholesale' | 'cafe' | 'landlord' | 'offsite' | 'government' | 'store' | 'construction';

export interface ShiftTemplate {
  days: number[]; // 0 = Monday
  start: number; // minute of day
  end: number;
}

export interface Position {
  id: Id;
  title: string;
  wage: Cents; // per hour
  shifts: ShiftTemplate[];
  payEvery: 'daily' | 'weekly';
  /** how many people the employer wants in this position */
  headcount: number;
  /** minimum skill xp requirements */
  requires: Record<string, number>;
  uniform: string | null;
  /** can the player actually perform this job in the current build */
  playable: boolean;
  description: string;
  duties: string[];
  /** what the job-holder prioritises on shift (shops): defaults to doing everything */
  role?: StaffRole;
}

export type StaffRole = 'manager' | 'cashier' | 'stocker' | 'cleaner' | 'general';

export interface DayStats {
  day: number;
  revenue: Cents;
  cogs: Cents;
  wages: Cents;
  otherCosts: Cents;
  customers: number;
  lostSales: number; // units wanted but unavailable
  walkouts: number;
}

export interface Business {
  id: Id;
  name: string;
  kind: BusinessKind;
  ownerId: Id;
  accountId: Id;
  locationId: Id;
  open: ShiftTemplate[]; // opening hours
  positions: Position[];
  prices: Record<string, Cents>;
  reputation: number; // 0..100 customer reputation
  cleanliness: number; // 0..100 (derived from dirt spots, cached)
  stats: DayStats[];
  supplierId: Id | null;
  /** product -> target backroom+shelf level for reordering */
  reorder: Record<string, { min: number; target: number }>;
  rentDue: Cents; // weekly premises cost (paid to landlord)
  utilitiesPerDay: Cents;
  /** weighted-average unit cost of stock, used for cost of goods sold */
  unitCost: Record<string, Cents>;
  /** containers that hold this business's sellable/stored stock */
  stockContainers: Id[];
  /** owner draw policy: keep this much cash, pay out a share of the excess weekly */
  cashReserve: Cents;
  /** wage arrears owed to staff when payroll could not be met */
  wageArrears: Cents;
  /** shelf section id -> product sold there (shops only) */
  sections: Record<string, string>;
  /** owner has closed the doors regardless of hours */
  manualClosed?: boolean;
  /** overnight shelf-fill crew (always on for NPC-run shops; the player can hire it) */
  nightFill?: boolean;
  /** installed equipment, e.g. { till: true } */
  equipment: Record<string, boolean>;
  /** player-owned: the owner decides on hiring instead of automatic offers */
  ownerDecidesHiring?: boolean;
  /** shelf id -> how untidy the facings are (0 neat .. 100 ransacked); customers' picks mess them up */
  messy?: Record<string, number>;
  /** emptied stock cases waiting to be flattened in the baler */
  cardboard?: number;
  /** litter bin by the door (0..BIN_CAPACITY) */
  binFill?: number;
  /** small per-business daily flags (e.g. the counter was staffed today) */
  flags?: Record<string, boolean>;
  /** customers waiting at a sales counter (furniture store), first is being served */
  queue?: Id[];
}

export interface Policy {
  incomeTax: number; // flat rate on wages
  salesTax: number; // included in shelf prices
  /** cash the government keeps before spending surplus on public services */
  reserve: Cents;
}

// ---------------------------------------------------------- employment
export interface Contract {
  id: Id;
  personId: Id;
  businessId: Id;
  positionId: Id;
  title: string;
  wage: Cents;
  shifts: ShiftTemplate[];
  payEvery: 'daily' | 'weekly';
  startDay: number;
  endDay: number | null;
  status: 'active' | 'ended';
  endReason?: string;
  warnings: number;
  /** rolling performance score 0..100 */
  performance: number;
  shiftsWorked: number;
  promotedFrom?: string;
}

export interface Attendance {
  key: string; // contractId:day
  contractId: Id;
  day: number;
  scheduledStart: number; // absolute minute
  scheduledEnd: number;
  clockIn: number | null;
  clockOut: number | null;
  minutesWorked: number;
  late: number; // minutes
  tasks: number;
  served: number;
  waitPenalty: number;
  uniformOk: boolean;
  paid: boolean;
  closed: boolean;
  absent: boolean;
  score: number | null;
  groomed?: boolean;
}

export interface Vacancy {
  id: Id;
  businessId: Id;
  positionId: Id;
  postedAt: number;
  closesAt: number;
  status: 'open' | 'filled' | 'closed';
  applicants: Id[]; // application ids
}

export interface Application {
  id: Id;
  vacancyId: Id;
  personId: Id;
  submittedAt: number;
  status: 'pending' | 'interview' | 'offered' | 'rejected' | 'accepted' | 'declined' | 'expired';
  score: number;
  answers: number[];
  offerExpires?: number;
  note?: string;
  /** in-person interview appointment (player applicants) */
  interviewAt?: number;
  interviewerId?: Id;
  interviewFeedback?: string[];
  /** ids of the questions this interviewer will ask */
  questions?: string[];
}

// --------------------------------------------------------------- tasks
export type TaskKind = 'restock' | 'serve' | 'clean' | 'receive' | 'face' | 'cardboard' | 'rubbish' | 'pick';

export interface Task {
  id: Id;
  businessId: Id;
  kind: TaskKind;
  target: Id; // interactable / spot / shipment id
  product?: string;
  status: 'open' | 'claimed' | 'done' | 'cancelled';
  claimedBy: Id | null;
  createdAt: number;
  doneAt: number | null;
  doneBy: Id | null;
}

export interface DirtSpot {
  id: Id;
  locationId: Id;
  pos: Vec2;
  dirt: number; // 0..100
  createdAt: number;
}

export interface TillState {
  id: Id; // interactable id
  businessId: Id;
  queue: Id[]; // person ids waiting, queue[0] is being served
  scanned: Record<string, number>; // items scanned for queue[0]
  staffId: Id | null; // person serving at the moment (set by action)
}

// ------------------------------------------------------------ logistics
export type ShipmentStatus = 'ordered' | 'loaded' | 'in_transit' | 'arrived' | 'received' | 'cancelled';

export interface Shipment {
  id: Id;
  supplierId: Id;
  buyerId: Id;
  items: Record<string, number>; // ordered
  loaded: Record<string, number>; // actually loaded (may be short)
  unitPrices: Record<string, Cents>;
  status: ShipmentStatus;
  orderedAt: number;
  dispatchAt: number;
  arrivedAt: number | null;
  receivedAt: number | null;
  receivedBy: Id | null;
  vehicleId: Id | null;
  invoiced: Cents;
  paid: boolean;
  note: string;
  /** units already picked from the racking into the dispatch staging lanes */
  picked?: Record<string, number>;
}

export interface Vehicle {
  id: Id;
  name: string;
  ownerId: Id;
  kind: 'van';
  pos: Vec2;
  heading: number;
  route: Vec2[];
  routeIdx: number;
  speed: number; // m per game minute
  /** 'loaded': waiting at the depot for the player driver; 'manual_out' / 'manual_back': the player is driving */
  state: 'parked' | 'driving_out' | 'unloading' | 'returning' | 'loaded' | 'manual_out' | 'manual_back';
  /** the player at the wheel (manual states) */
  driverId?: Id | null;
  cargoId: Id; // container
  shipmentId: Id | null;
  waitUntil: number;
  condition: number;
  odometer: number;
}

// -------------------------------------------------------------- housing
export interface Lease {
  id: Id;
  tenantId: Id;
  /** set for commercial leases paid by a business account */
  tenantBusinessId?: Id;
  landlordId: Id; // business id
  locationId: Id;
  label: string;
  weeklyRent: Cents;
  dueDay: number; // day of week (0 = Monday)
  dueMinute: number;
  paidThroughDay: number; // rent paid up to (exclusive) this day index
  arrears: Cents;
  missedPayments: number;
  status: 'active' | 'ended';
  /** the tenant bought the property (the lease ended by sale, not eviction) */
  bought?: boolean;
}

// --------------------------------------------------------------- news
export type NewsKind = 'info' | 'good' | 'bad' | 'job' | 'money' | 'world';

export interface NewsItem {
  id: Id;
  time: number;
  kind: NewsKind;
  title: string;
  body: string;
  personal: boolean; // directed at the player
  read: boolean;
}

export interface Objective {
  id: string;
  text: string;
  done: boolean;
}

export interface AggregateDistrict {
  id: Id;
  name: string;
  households: number;
  accountId: Id;
  /** average weekly grocery spend per household (cents) */
  groceryBudget: Cents;
  /** fraction of the district's grocery demand that reaches the corner shop */
  shopShare: number;
  demandAccumulator: number;
  cafeAccumulator: number;
  shopDemand: Record<string, number>;
  /** economic condition index (1 = normal) */
  confidence: number;
}

import type { HomeDesign } from './world/homes';

export interface GameState {
  /** how each home is furnished and decorated (by home id) */
  homeDesigns: Record<string, HomeDesign>;
  /** personal loans (bank.ts) */
  loans?: Record<Id, import('./bank').Loan>;
  creditBans?: Record<Id, boolean>;
  /** homes owned outright or with a mortgage (property.ts), by location */
  ownership?: Record<Id, import('./property').Ownership>;
  /** the house being built at the end of Harbour Road (construction.ts) */
  build?: import('./construction').Build;
  /** a Harbour Home order waiting to be delivered and fitted */
  pendingHome?: { design: HomeDesign; fitAt: number };
  version: number;
  seed: number;
  rng: number;
  minute: number; // absolute game minute (day 0 00:00 Monday)
  timeScale: number; // game minutes per real second
  counters: Record<string, number>;
  ledger: LedgerState;
  containers: Record<Id, Container>;
  people: Record<Id, Person>;
  playerId: Id;
  businesses: Record<Id, Business>;
  contracts: Record<Id, Contract>;
  attendance: Record<string, Attendance>;
  vacancies: Record<Id, Vacancy>;
  applications: Record<Id, Application>;
  tasks: Record<Id, Task>;
  dirt: Record<Id, DirtSpot>;
  tills: Record<Id, TillState>;
  shipments: Record<Id, Shipment>;
  vehicles: Record<Id, Vehicle>;
  leases: Record<Id, Lease>;
  districts: Record<Id, AggregateDistrict>;
  news: NewsItem[];
  objectives: Objective[];
  /** idempotency keys for scheduled processing (payroll, rent, daily close...) */
  processed: Record<string, number>;
  governmentId: Id; // business id of the council
  externalId: Id; // account id of the rest-of-world boundary
  policy: Policy;
  flags: Record<string, boolean>;
}
