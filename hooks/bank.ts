// What the store keeps, read back as a save. The file is the person's own
// and outlives every version of the game, so nothing in it is taken on trust:
// a field that is missing or is not what it should be reads as a fresh one.

import type { TycoonSave, TycoonSettings, TycoonStats } from '../types'
import { FEATS, GENERATORS, UPGRADES } from './catalog'
import { fresh } from './sim'

const UPGRADE_IDS = new Set(UPGRADES.map(upgrade => upgrade.id))
const FEAT_IDS = new Set(FEATS.map(feat => feat.id))
const GENERATOR_IDS = new Set(GENERATORS.map(generator => generator.id))

/** What a kept value holds under a key, when it is an object that has it. */
export const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined

export const toAmount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

export const toCount = (value: unknown): number => Math.floor(toAmount(value))

/** The counts under the keys `isKnown` takes, each a whole number. */
const toCounts = (
  value: unknown,
  isKnown: (key: string) => boolean,
): Record<string, number> =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => isKnown(key))
          .map(([key, count]) => [key, toCount(count)]),
      )
    : {}

/** The ids of the list that the catalog still has, each once. */
const toIds = (value: unknown, known: ReadonlySet<string>): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter(id => typeof id === 'string' && known.has(id)))]
    : []

const toStats = (value: unknown): TycoonStats => ({
  calls: toCount(fieldOf(value, 'calls')),
  fails: toCount(fieldOf(value, 'fails')),
  clicks: toCount(fieldOf(value, 'clicks')),
  turns: toCount(fieldOf(value, 'turns')),
  burned: toCount(fieldOf(value, 'burned')),
  bought: toCount(fieldOf(value, 'bought')),
})

/** The save as kept, or a fresh one from `now` when nothing is kept. */
export const toSave = (value: unknown, now: number): TycoonSave => {
  if (typeof value !== 'object' || value === null) {
    return fresh(now)
  }

  const at = toAmount(fieldOf(value, 'at'))

  return {
    v: 1,
    tokens: toAmount(fieldOf(value, 'tokens')),
    at: at === 0 ? now : at,
    runEarned: toAmount(fieldOf(value, 'runEarned')),
    lifeEarned: toAmount(fieldOf(value, 'lifeEarned')),
    owned: toCounts(fieldOf(value, 'owned'), id => GENERATOR_IDS.has(id)),
    upgrades: toIds(fieldOf(value, 'upgrades'), UPGRADE_IDS),
    feats: toIds(fieldOf(value, 'feats'), FEAT_IDS),
    weights: toCount(fieldOf(value, 'weights')),
    ships: toCount(fieldOf(value, 'ships')),
    calls: toCounts(fieldOf(value, 'calls'), () => true),
    stats: toStats(fieldOf(value, 'stats')),
  }
}

export const toSettings = (value: unknown): TycoonSettings => ({
  hasHint: fieldOf(value, 'hasHint') !== false,
  isClosed: fieldOf(value, 'isClosed') === true,
})
