// The economy itself, with nothing of the pane or the engine in it: a save
// goes in, a save comes out. A move that changes nothing answers the save it
// was given, so a caller tells a refusal by the reference.

import type { TycoonCombo, TycoonFamily, TycoonSave } from '../types'
import { FAMILIES, FEATS, GENERATORS, RANKS, UPGRADES } from './catalog'
import type { Effect, Feat, Gate, Generator, Upgrade } from './catalog'

/** What the bought upgrades, the weights and the feats come to. */
export type Perks = {
  generators: Readonly<Record<string, number>>
  families: Readonly<Record<string, number>>
  click: number
  // Seconds of the generators' rate each call also pays.
  seconds: number
  // How high a streak of calls builds.
  cap: number
  // How long the generators run on after the last activity.
  windowMs: number
  // What weights and feats multiply every income by.
  all: number
}

const HOUR = 3_600_000
const GROWTH = 1.15
const BASE_WINDOW_HOURS = 1
const BASE_CAP = 2
const COMBO_STEP = 0.1
// A call this soon after the last builds the streak; one later than the
// second ends it; between the two it holds.
const COMBO_BUILDS_MS = 20_000
const COMBO_ENDS_MS = 60_000
const FAIL_SHARE = 0.5
// The share of a call's seconds a click by hand pays.
const CLICK_SHARE = 0.1
// The end of a turn is paid as so many calls: one per this many output
// tokens, within these bounds.
const TOKENS_PER_CALL = 400
const MIN_PAID_CALLS = 1
const MAX_PAID_CALLS = 25
// Lifetime earnings the first weight takes; the count grows as their cube root.
const SHIP_AT = 1e9
export const WEIGHT_BONUS = 0.05
export const FEAT_BONUS = 0.02

const UPGRADE_BY_ID = new Map(UPGRADES.map(upgrade => [upgrade.id, upgrade]))
const GENERATOR_BY_ID = new Map(
  GENERATORS.map(generator => [generator.id, generator]),
)
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'ToolSearch']
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const BASH_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'Monitor']
const WEB_TOOLS = ['WebFetch', 'WebSearch']
const AGENT_TOOLS = ['Agent', 'Task', 'Workflow', 'SendMessage']

export const fresh = (now: number): TycoonSave => ({
  v: 1,
  tokens: 0,
  at: now,
  runEarned: 0,
  lifeEarned: 0,
  owned: {},
  upgrades: [],
  feats: [],
  weights: 0,
  ships: 0,
  calls: {},
  stats: { calls: 0, fails: 0, clicks: 0, turns: 0, burned: 0, bought: 0 },
})

/** The family a tool's calls are paid as, by the tool's name. */
export const familyOf = (tool: string): TycoonFamily => {
  const kinds: readonly [readonly string[], TycoonFamily][] = [
    [READ_TOOLS, 'read'],
    [EDIT_TOOLS, 'edit'],
    [BASH_TOOLS, 'bash'],
    [WEB_TOOLS, 'web'],
    [AGENT_TOOLS, 'agent'],
  ]

  if (tool.startsWith('mcp__')) {
    return 'mcp'
  }

  return kinds.find(([tools]) => tools.includes(tool))?.[1] ?? 'other'
}

const applied = (perks: Perks, effect: Effect): Perks => {
  switch (effect.kind) {
    case 'generator':
      return {
        ...perks,
        generators: {
          ...perks.generators,
          [effect.id]: (perks.generators[effect.id] ?? 1) * effect.times,
        },
      }
    case 'family':
      return {
        ...perks,
        families: {
          ...perks.families,
          [effect.family]: (perks.families[effect.family] ?? 1) * effect.times,
        },
      }
    case 'click':
      return { ...perks, click: perks.click * effect.times }
    case 'seconds':
      return { ...perks, seconds: Math.max(perks.seconds, effect.seconds) }
    case 'combo':
      return { ...perks, cap: Math.max(perks.cap, effect.cap) }
    case 'window':
      return {
        ...perks,
        windowMs: Math.max(perks.windowMs, effect.hours * HOUR),
      }
  }
}

export const perksOf = (save: TycoonSave): Perks =>
  save.upgrades
    .map(id => UPGRADE_BY_ID.get(id)?.effect)
    .filter(effect => effect !== undefined)
    .reduce(applied, {
      generators: {},
      families: {},
      click: 1,
      seconds: 0,
      cap: BASE_CAP,
      windowMs: BASE_WINDOW_HOURS * HOUR,
      all:
        (1 + WEIGHT_BONUS * save.weights) *
        (1 + FEAT_BONUS * save.feats.length),
    })

/** What one of a generator makes a second, its upgrades and `all` counted. */
export const yieldOf = (generator: Generator, perks: Perks): number =>
  generator.rate * (perks.generators[generator.id] ?? 1) * perks.all

/** Tokens a second from every generator owned. */
export const rateOf = (save: TycoonSave, perks = perksOf(save)): number =>
  GENERATORS.reduce(
    (sum, generator) =>
      sum + (save.owned[generator.id] ?? 0) * yieldOf(generator, perks),
    0,
  )

const earning = (save: TycoonSave, gain: number): TycoonSave => ({
  ...save,
  tokens: save.tokens + gain,
  runEarned: save.runEarned + gain,
  lifeEarned: save.lifeEarned + gain,
})

/**
 * The save brought up to `now`: what the generators made since it was last
 * settled, for no longer than the context window lasts.
 */
export const settled = (save: TycoonSave, now: number): TycoonSave => {
  const perks = perksOf(save)
  const ran = Math.min(Math.max(0, now - save.at), perks.windowMs)

  return { ...earning(save, (rateOf(save, perks) * ran) / 1000), at: now }
}

/** How much longer the generators run if nothing settles the save. */
export const windowLeft = (save: TycoonSave, now: number): number =>
  Math.max(0, perksOf(save).windowMs - Math.max(0, now - save.at))

/** What one call of the family pays, before the streak. */
export const wageOf = (save: TycoonSave, family: TycoonFamily): number => {
  const perks = perksOf(save)
  const flat = FAMILIES[family].wage * perks.all
  const share = rateOf(save, perks) * perks.seconds

  return (flat + share) * (perks.families[family] ?? 1)
}

/** What one click by hand pays. */
export const clickOf = (save: TycoonSave): number => {
  const perks = perksOf(save)

  return (
    (perks.all + rateOf(save, perks) * perks.seconds * CLICK_SHARE) * perks.click
  )
}

const counted = (save: TycoonSave, family: TycoonFamily): TycoonSave => ({
  ...save,
  calls: { ...save.calls, [family]: (save.calls[family] ?? 0) + 1 },
})

/** The streak after a call at `now`: built, held or begun again. */
export const comboAfter = (
  combo: TycoonCombo,
  now: number,
  cap: number,
): TycoonCombo => {
  const since = now - combo.at

  if (since > COMBO_ENDS_MS || since < 0) {
    return { level: 1, at: now }
  }

  const level = since <= COMBO_BUILDS_MS ? combo.level + COMBO_STEP : combo.level

  return { level: Math.min(cap, Math.max(1, level)), at: now }
}

/** A tool call paid: the family's wage, the streak's times, half if it failed. */
export const called = (
  save: TycoonSave,
  family: TycoonFamily,
  isFailed: boolean,
  streak: number,
): TycoonSave => {
  const gain = wageOf(save, family) * streak * (isFailed ? FAIL_SHARE : 1)
  const paid = counted(earning(save, gain), family)

  return {
    ...paid,
    stats: {
      ...paid.stats,
      calls: paid.stats.calls + 1,
      fails: paid.stats.fails + (isFailed ? 1 : 0),
    },
  }
}

/** The end of a turn paid, by the output tokens it really cost. */
export const salaried = (save: TycoonSave, outputTokens: number): TycoonSave => {
  const calls = Math.min(
    MAX_PAID_CALLS,
    Math.max(MIN_PAID_CALLS, outputTokens / TOKENS_PER_CALL),
  )
  const paid = counted(earning(save, wageOf(save, 'turn') * calls), 'turn')

  return {
    ...paid,
    stats: {
      ...paid.stats,
      turns: paid.stats.turns + 1,
      burned: paid.stats.burned + Math.max(0, outputTokens),
    },
  }
}

export const clicked = (save: TycoonSave, count: number): TycoonSave => {
  const paid = earning(save, clickOf(save) * count)

  return { ...paid, stats: { ...paid.stats, clicks: paid.stats.clicks + count } }
}

/** What the next `count` of a generator cost when `owned` are owned already. */
export const priceOf = (
  generator: Generator,
  owned: number,
  count: number,
): number =>
  (generator.cost * GROWTH ** owned * (GROWTH ** count - 1)) / (GROWTH - 1)

export const bought = (
  save: TycoonSave,
  id: string,
  count: number,
): TycoonSave => {
  const generator = GENERATOR_BY_ID.get(id)
  const owned = save.owned[id] ?? 0
  const cost = generator === undefined ? 0 : priceOf(generator, owned, count)

  if (generator === undefined || save.tokens < cost) {
    return save
  }

  return {
    ...save,
    tokens: save.tokens - cost,
    owned: { ...save.owned, [id]: owned + count },
    stats: { ...save.stats, bought: save.stats.bought + count },
  }
}

export const isMet = (gate: Gate, save: TycoonSave): boolean => {
  switch (gate.kind) {
    case 'none':
      return true
    case 'owned':
      return (save.owned[gate.id] ?? 0) >= gate.count
    case 'calls':
      return gate.family === undefined
        ? save.stats.calls >= gate.count
        : (save.calls[gate.family] ?? 0) >= gate.count
    case 'clicks':
      return save.stats.clicks >= gate.count
    case 'fails':
      return save.stats.fails >= gate.count
    case 'earned':
      return save.lifeEarned >= gate.amount
    case 'burned':
      return save.stats.burned >= gate.amount
    case 'ships':
      return save.ships >= gate.count
  }
}

const isOpen = (upgrade: Upgrade, save: TycoonSave): boolean =>
  !save.upgrades.includes(upgrade.id) &&
  (upgrade.after === undefined || save.upgrades.includes(upgrade.after)) &&
  isMet(upgrade.gate, save)

/** The upgrades that can be bought now, the cheapest first. */
export const openUpgrades = (save: TycoonSave): Upgrade[] =>
  UPGRADES.filter(upgrade => isOpen(upgrade, save)).sort(
    (one, other) => one.cost - other.cost,
  )

export const upgraded = (save: TycoonSave, id: string): TycoonSave => {
  const upgrade = UPGRADE_BY_ID.get(id)

  if (
    upgrade === undefined ||
    !isOpen(upgrade, save) ||
    save.tokens < upgrade.cost
  ) {
    return save
  }

  return {
    ...save,
    tokens: save.tokens - upgrade.cost,
    upgrades: [...save.upgrades, id],
  }
}

/** Every open upgrade the balance covers, the cheapest first, bought. */
export const upgradedAll = (save: TycoonSave): TycoonSave => {
  const cheapest = openUpgrades(save)[0]
  const after = cheapest === undefined ? save : upgraded(save, cheapest.id)

  return after === save ? save : upgradedAll(after)
}

/** The feats the save has earned and not yet been given. */
export const featsDue = (save: TycoonSave): Feat[] =>
  FEATS.filter(
    feat => !save.feats.includes(feat.id) && isMet(feat.gate, save),
  )

/** The save with every feat it has earned. */
export const honored = (save: TycoonSave): TycoonSave => {
  const due = featsDue(save)

  return due.length === 0
    ? save
    : { ...save, feats: [...save.feats, ...due.map(feat => feat.id)] }
}

const weightsAt = (lifeEarned: number): number =>
  Math.floor(Math.cbrt(lifeEarned / SHIP_AT) + 1e-9)

/** The weights a ship would pay now. */
export const weightsDue = (save: TycoonSave): number =>
  Math.max(0, weightsAt(save.lifeEarned) - save.weights)

/** Lifetime earnings at which the next weight is due. */
export const nextWeightAt = (save: TycoonSave): number =>
  SHIP_AT * (Math.max(save.weights, weightsAt(save.lifeEarned)) + 1) ** 3

/**
 * The model shipped: the run's tokens, generators and upgrades are given up
 * for the weights due. Feats, counts and the weights themselves are kept.
 */
export const shipped = (save: TycoonSave): TycoonSave => {
  const due = weightsDue(save)

  if (due === 0) {
    return save
  }

  return {
    ...save,
    tokens: 0,
    runEarned: 0,
    owned: {},
    upgrades: [],
    weights: save.weights + due,
    ships: save.ships + 1,
  }
}

export const rankOf = (ships: number): string =>
  RANKS.findLast(rank => ships >= rank.ships)?.name ?? ''
