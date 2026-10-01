// Everything the game sells and awards, as data: the rules in sim.ts read it
// and keep none of their own, so a new tier is a new row here.

import type { TycoonFamily } from '../types'
import { grouped, short } from './format'

export type Generator = { id: string; name: string; cost: number; rate: number }

/** What has to be true of a save before an upgrade opens or a feat is earned. */
export type Gate =
  | { kind: 'none' }
  | { kind: 'owned'; id: string; count: number }
  | { kind: 'calls'; count: number; family?: TycoonFamily }
  | { kind: 'clicks'; count: number }
  | { kind: 'fails'; count: number }
  | { kind: 'earned'; amount: number }
  | { kind: 'burned'; amount: number }
  | { kind: 'ships'; count: number }

export type Effect =
  | { kind: 'generator'; id: string; times: number }
  | { kind: 'family'; family: TycoonFamily; times: number }
  | { kind: 'click'; times: number }
  // Each call also pays this many seconds of what the generators make.
  | { kind: 'seconds'; seconds: number }
  | { kind: 'combo'; cap: number }
  | { kind: 'window'; hours: number }

export type Upgrade = {
  id: string
  name: string
  note: string
  // The note in a few words, for a row with little room.
  tag: string
  cost: number
  gate: Gate
  effect: Effect
  // The upgrade that has to be bought first: the tier before it in its line.
  after?: string
}

export type Feat = { id: string; name: string; note: string; gate: Gate }

type Family = {
  name: string
  wage: number
  // How often its calls come, next to a read's: its tiers open that much sooner.
  pace: number
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

export const GENERATORS: readonly Generator[] = [
  { id: 'prompt', name: 'Prompt', cost: 15, rate: 0.1 },
  { id: 'script', name: 'Script', cost: 150, rate: 0.6 },
  { id: 'subagent', name: 'Subagent', cost: 2.5e3, rate: 4 },
  { id: 'mcp', name: 'MCP Server', cost: 5e4, rate: 25 },
  { id: 'workflow', name: 'Workflow', cost: 1e6, rate: 150 },
  { id: 'finetune', name: 'Fine-tune', cost: 2.5e7, rate: 900 },
  { id: 'rack', name: 'GPU Rack', cost: 6e8, rate: 5.5e3 },
  { id: 'datacenter', name: 'Datacenter', cost: 1.5e10, rate: 3.3e4 },
  { id: 'fusion', name: 'Fusion Plant', cost: 4e11, rate: 2e5 },
  { id: 'orbital', name: 'Orbital Array', cost: 1.2e13, rate: 1.2e6 },
  { id: 'dyson', name: 'Dyson Swarm', cost: 4e14, rate: 7.5e6 },
  { id: 'brain', name: 'Matrioshka Brain', cost: 1.5e16, rate: 5e7 },
]

export const FAMILIES: Readonly<Record<TycoonFamily, Family>> = {
  read: { name: 'Research', wage: 1, pace: 1 },
  edit: { name: 'Editing', wage: 3, pace: 1 },
  bash: { name: 'Shell', wage: 2, pace: 1 },
  web: { name: 'Web', wage: 3, pace: 0.2 },
  agent: { name: 'Delegation', wage: 8, pace: 0.2 },
  mcp: { name: 'Integrations', wage: 3, pace: 0.5 },
  other: { name: 'Odd jobs', wage: 1, pace: 0.5 },
  turn: { name: 'Payroll', wage: 2, pace: 0.2 },
}

const FAMILY_IDS: readonly TycoonFamily[] = [
  'read',
  'edit',
  'bash',
  'web',
  'agent',
  'mcp',
  'other',
  'turn',
]

// How many of a generator open each of its tiers, and the tier's cost as a
// multiple of the generator's own first cost.
const GENERATOR_TIERS = [
  { count: 1, times: 10 },
  { count: 5, times: 50 },
  { count: 25, times: 500 },
  { count: 50, times: 5e4 },
  { count: 100, times: 5e6 },
  { count: 150, times: 5e8 },
  { count: 200, times: 5e10 },
  { count: 250, times: 5e12 },
  { count: 300, times: 5e14 },
  { count: 400, times: 5e17 },
]
const FAMILY_TIERS = [
  { count: 10, cost: 200 },
  { count: 100, cost: 1e4 },
  { count: 500, cost: 1e6 },
  { count: 2_000, cost: 1e8 },
  { count: 10_000, cost: 1e10 },
  { count: 50_000, cost: 1e13 },
  { count: 250_000, cost: 1e16 },
]
const FAMILY_TIMES = 1.25
const SECONDS_TIERS = [
  { count: 50, cost: 500, seconds: 0.1 },
  { count: 250, cost: 2.5e4, seconds: 0.25 },
  { count: 1_000, cost: 1e6, seconds: 0.5 },
  { count: 5_000, cost: 1e8, seconds: 1 },
  { count: 20_000, cost: 1e10, seconds: 2 },
  { count: 75_000, cost: 1e13, seconds: 3 },
  { count: 250_000, cost: 1e16, seconds: 5 },
]
const CLICK_TIERS = [
  { count: 10, cost: 50 },
  { count: 100, cost: 1e3 },
  { count: 500, cost: 5e4 },
  { count: 2_000, cost: 5e6 },
  { count: 10_000, cost: 5e9 },
  { count: 50_000, cost: 5e12 },
]
const COMBO_TIERS = [
  { count: 100, cost: 2e3, cap: 3 },
  { count: 500, cost: 1e5, cap: 4 },
  { count: 2_500, cost: 1e7, cap: 5 },
  { count: 10_000, cost: 1e9, cap: 6 },
  { count: 50_000, cost: 1e12, cap: 8 },
]
const WINDOW_TIERS = [
  { hours: 2, cost: 1e3 },
  { hours: 4, cost: 1e5 },
  { hours: 8, cost: 1e7 },
  { hours: 12, cost: 1e9 },
  { hours: 24, cost: 1e12 },
]

/** The upgrades as one line: each after the first waits on the one before it. */
const chained = (line: readonly Upgrade[]): Upgrade[] =>
  line.map((upgrade, at) => {
    const before = line[at - 1]

    return before === undefined ? upgrade : { ...upgrade, after: before.id }
  })

const generatorLine = (generator: Generator): Upgrade[] =>
  chained(
    GENERATOR_TIERS.map((tier, at) => ({
      id: `${generator.id}-${at + 1}`,
      name: `${generator.name} ${ROMAN[at]}`,
      note: `${generator.name}s make twice as much`,
      tag: '×2 made',
      cost: generator.cost * tier.times,
      gate: { kind: 'owned', id: generator.id, count: tier.count },
      effect: { kind: 'generator', id: generator.id, times: 2 },
    })),
  )

const familyLine = (family: TycoonFamily): Upgrade[] =>
  chained(
    FAMILY_TIERS.map((tier, at) => ({
      id: `${family}-wage-${at + 1}`,
      name: `${FAMILIES[family].name} ${ROMAN[at]}`,
      note:
        family === 'turn'
          ? 'The end of a turn pays a quarter more'
          : `${FAMILIES[family].name} calls pay a quarter more`,
      tag: '+25% pay',
      cost: tier.cost,
      gate: {
        kind: 'calls',
        family,
        count: Math.ceil(tier.count * FAMILIES[family].pace),
      },
      effect: { kind: 'family', family, times: FAMILY_TIMES },
    })),
  )

export const UPGRADES: readonly Upgrade[] = [
  ...GENERATORS.flatMap(generatorLine),
  ...FAMILY_IDS.flatMap(familyLine),
  ...chained(
    SECONDS_TIERS.map((tier, at) => ({
      id: `seconds-${at + 1}`,
      name: `Throughput ${ROMAN[at]}`,
      note: `Every call also pays ${tier.seconds}s of what the generators make`,
      tag: `+${tier.seconds}s a call`,
      cost: tier.cost,
      gate: { kind: 'calls', count: tier.count },
      effect: { kind: 'seconds', seconds: tier.seconds },
    })),
  ),
  ...chained(
    CLICK_TIERS.map((tier, at) => ({
      id: `click-${at + 1}`,
      name: `Mining Rig ${ROMAN[at]}`,
      note: 'Mining by hand pays twice as much',
      tag: '×2 mined',
      cost: tier.cost,
      gate: { kind: 'clicks', count: tier.count },
      effect: { kind: 'click', times: 2 },
    })),
  ),
  ...chained(
    COMBO_TIERS.map((tier, at) => ({
      id: `combo-${at + 1}`,
      name: `Flow State ${ROMAN[at]}`,
      note: `A streak of calls builds up to ×${tier.cap}`,
      tag: `streak to ×${tier.cap}`,
      cost: tier.cost,
      gate: { kind: 'calls', count: tier.count },
      effect: { kind: 'combo', cap: tier.cap },
    })),
  ),
  ...chained(
    WINDOW_TIERS.map((tier, at) => ({
      id: `window-${at + 1}`,
      name: `Context Window ${ROMAN[at]}`,
      note: `Generators run on for ${tier.hours}h after the last activity`,
      tag: `runs ${tier.hours}h alone`,
      cost: tier.cost,
      gate: { kind: 'none' },
      effect: { kind: 'window', hours: tier.hours },
    })),
  ),
]

const CALL_FEATS = [
  { count: 1, name: 'Hello, world' },
  { count: 100, name: 'Warming up' },
  { count: 1_000, name: 'In the flow' },
  { count: 10_000, name: 'Ten thousand calls' },
  { count: 100_000, name: 'Tool belt' },
  { count: 1_000_000, name: 'The millionth call' },
]
const EARNED_FEATS = [
  { amount: 1e3, name: 'First thousand' },
  { amount: 1e6, name: 'Millionaire' },
  { amount: 1e9, name: 'Billionaire' },
  { amount: 1e12, name: 'Trillionaire' },
  { amount: 1e15, name: 'Quadrillionaire' },
  { amount: 1e18, name: 'Quintillionaire' },
  { amount: 1e21, name: 'Sextillionaire' },
  { amount: 1e24, name: 'Septillionaire' },
]
const SHIP_FEATS = [
  { count: 1, name: 'Shipped' },
  { count: 5, name: 'Release train' },
  { count: 10, name: 'Model zoo' },
  { count: 25, name: 'Frontier lab' },
]
const BURNED_FEATS = [
  { amount: 1e6, name: 'Token burner' },
  { amount: 1e8, name: 'Furnace' },
]
const VETERAN_AT = 1_000
const FARM_AT = 100

export const FEATS: readonly Feat[] = [
  ...CALL_FEATS.map(({ count, name }) => ({
    id: `calls-${count}`,
    name,
    note: `Claude made ${grouped(count)} tool calls`,
    gate: { kind: 'calls', count } as const,
  })),
  ...EARNED_FEATS.map(({ amount, name }) => ({
    id: `earned-${amount}`,
    name,
    note: `Earned ${short(amount)} tokens in all`,
    gate: { kind: 'earned', amount } as const,
  })),
  ...GENERATORS.flatMap(({ id, name }) => [
    {
      id: `first-${id}`,
      name: `First ${name}`,
      note: `Bought a ${name}`,
      gate: { kind: 'owned', id, count: 1 } as const,
    },
    {
      id: `farm-${id}`,
      name: `${name} farm`,
      note: `Own ${FARM_AT} of the ${name}`,
      gate: { kind: 'owned', id, count: FARM_AT } as const,
    },
  ]),
  ...FAMILY_IDS.filter(family => family !== 'turn').map(family => ({
    id: `veteran-${family}`,
    name: `${FAMILIES[family].name} veteran`,
    note: `${Math.ceil(VETERAN_AT * FAMILIES[family].pace)} ${FAMILIES[family].name} calls`,
    gate: {
      kind: 'calls',
      family,
      count: Math.ceil(VETERAN_AT * FAMILIES[family].pace),
    } as const,
  })),
  ...SHIP_FEATS.map(({ count, name }) => ({
    id: `ships-${count}`,
    name,
    note: `Shipped ${count} ${count === 1 ? 'model' : 'models'}`,
    gate: { kind: 'ships', count } as const,
  })),
  ...BURNED_FEATS.map(({ amount, name }) => ({
    id: `burned-${amount}`,
    name,
    note: `Claude's turns wrote ${short(amount)} real tokens`,
    gate: { kind: 'burned', amount } as const,
  })),
  {
    id: 'fails-100',
    name: 'It works on my machine',
    note: '100 tool calls failed',
    gate: { kind: 'fails', count: 100 },
  },
  {
    id: 'clicks-1000',
    name: 'Hands-on',
    note: 'Mined by hand 1,000 times',
    gate: { kind: 'clicks', count: 1_000 },
  },
]

// What a ship count is called, from the first run on.
export const RANKS: readonly { ships: number; name: string }[] = [
  { ships: 0, name: 'Haiku' },
  { ships: 1, name: 'Sonnet' },
  { ships: 3, name: 'Opus' },
  { ships: 6, name: 'Fable' },
  { ships: 10, name: 'Mythos' },
]
