// What a tab lists and what a key means there. The pane that draws the rows
// and the hooks module that acts on a key both read it here, so a row's key
// is the same in both.

import type { TycoonSave, TycoonView } from '../types'
import { FAMILIES, FEATS, GENERATORS } from './catalog'
import type { Generator, Upgrade } from './catalog'
import { counted, grouped, short } from './format'
import {
  FEAT_BONUS,
  WEIGHT_BONUS,
  nextWeightAt,
  openUpgrades,
  rankOf,
  weightsDue,
} from './sim'

type Tab = TycoonView['tab']

/** What a key asks for, in the tab it was pressed in. */
export type Action =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'qty' }
  | { kind: 'mine' }
  | { kind: 'buy'; id: string }
  | { kind: 'upgrade'; id: string }
  | { kind: 'upgradeAll' }
  | { kind: 'ship' }

/** One line of a tab that is read and not pressed. */
export type Line = { text: string; isDim?: true }

export const TABS: readonly { tab: Tab; key: string; name: string }[] = [
  { tab: 'build', key: 'g', name: 'Build' },
  { tab: 'upgrades', key: 'u', name: 'Upgrades' },
  { tab: 'records', key: 'r', name: 'Records' },
  { tab: 'ship', key: 'p', name: 'Ship' },
]
// A row's key by its place in the list: the digits, then two letters no tab
// or control takes.
export const ROW_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'q', 'w']
// From this width on the game sets its stage beside its shop, and needs
// fewer rows for it.
export const WIDE_FROM = 100
export const QTY_KEY = 'x'
export const ALL_KEY = 'b'
export const SHIP_KEY = 'y'
export const QTYS = [1, 10, 100] as const
const MINE_KEYS = [' ', 'm']
const UPGRADE_ROWS = 9
const LATEST_FEATS = 3
const NEXT_FEATS = 3
// Generators listed past the last one owned: what to save up for.
const AHEAD = 2

/** The generators the build tab lists, each under the key of its place. */
export const generatorRows = (save: TycoonSave): readonly Generator[] => {
  const last = GENERATORS.findLastIndex(({ id }) => (save.owned[id] ?? 0) > 0)

  return GENERATORS.slice(0, last + 1 + AHEAD)
}

/** The upgrades the upgrades tab lists, the cheapest first. */
export const upgradeRows = (save: TycoonSave): readonly Upgrade[] =>
  openUpgrades(save).slice(0, UPGRADE_ROWS)

/** How many more a buy takes after `qty`: 1, 10, 100 and round again. */
export const qtyAfter = (qty: TycoonView['qty']): TycoonView['qty'] =>
  QTYS[(QTYS.indexOf(qty) + 1) % QTYS.length] ?? 1

export const actionOf = (
  key: string,
  save: TycoonSave,
  view: TycoonView,
): Action | undefined => {
  const tab = TABS.find(one => one.key === key)
  const row = ROW_KEYS.indexOf(key)

  if (tab !== undefined) {
    return { kind: 'tab', tab: tab.tab }
  }

  if (MINE_KEYS.includes(key)) {
    return { kind: 'mine' }
  }

  if (view.tab === 'build') {
    const generator = row < 0 ? undefined : generatorRows(save)[row]

    if (generator !== undefined) {
      return { kind: 'buy', id: generator.id }
    }

    return key === QTY_KEY ? { kind: 'qty' } : undefined
  }

  if (view.tab === 'upgrades') {
    const upgrade = row < 0 ? undefined : upgradeRows(save)[row]

    if (upgrade !== undefined) {
      return { kind: 'upgrade', id: upgrade.id }
    }

    return key === ALL_KEY ? { kind: 'upgradeAll' } : undefined
  }

  return view.tab === 'ship' && key === SHIP_KEY ? { kind: 'ship' } : undefined
}

export const percent = (share: number): string => `${Math.round(share * 100)}%`

/** The records tab: the rank, the counts and the achievements. */
export const recordLines = (save: TycoonSave): Line[] => {
  const { stats } = save
  const families = Object.entries(FAMILIES)
    .filter(([family]) => family !== 'turn')
    .map(([family, { name }]) => `${name} ${grouped(save.calls[family] ?? 0)}`)
    .join(' · ')
  const latest = save.feats
    .slice(-LATEST_FEATS)
    .map(id => FEATS.find(feat => feat.id === id)?.name ?? id)
    .join(', ')
  const coming = FEATS.filter(feat => !save.feats.includes(feat.id)).slice(
    0,
    NEXT_FEATS,
  )

  return [
    {
      text: `${rankOf(save.ships)} · ${save.ships} shipped · ${counted(save.weights, 'weight')} (+${percent(save.weights * WEIGHT_BONUS)})`,
    },
    {
      text: `Earned ◈${short(save.runEarned)} this run · ◈${short(save.lifeEarned)} in all`,
    },
    {
      text: `${counted(stats.calls, 'call')}, ${grouped(stats.fails)} failed · ${counted(stats.turns, 'turn')} · mined ${counted(stats.clicks, 'time')}`,
    },
    { text: families, isDim: true },
    {
      text: `Claude wrote ${short(stats.burned)} real tokens · ${counted(stats.bought, 'generator')} bought`,
      isDim: true,
    },
    {
      text: `Achievements ${save.feats.length} of ${FEATS.length} (+${percent(save.feats.length * FEAT_BONUS)})${latest === '' ? '' : ` · latest: ${latest}`}`,
    },
    ...coming.map(feat => ({
      text: `  next: ${feat.name}: ${feat.note}`,
      isDim: true as const,
    })),
  ]
}

/** The ship tab: what a ship gives up, what it pays, and how far the next is. */
export const shipLines = (save: TycoonSave): Line[] => {
  const due = weightsDue(save)

  return [
    {
      text: "Ship a new model: this run's tokens, generators and upgrades are given up for weights.",
    },
    {
      text: `Each weight adds ${percent(WEIGHT_BONUS)} to everything you earn, for good. Achievements and counts stay.`,
      isDim: true,
    },
    {
      text:
        due === 0
          ? `${counted(save.weights, 'weight')} now · the next one comes at ◈${short(nextWeightAt(save))} earned in all, of which you have ◈${short(save.lifeEarned)}`
          : `${counted(save.weights, 'weight')} now · a ship pays ${due} more`,
    },
  ]
}

/** What the ship key is asked with: once to arm, again to ship. */
export const shipLabel = (save: TycoonSave, view: TycoonView): string =>
  view.isArmed
    ? 'again: give this run up and ship'
    : `ship for ${counted(weightsDue(save), 'weight')}`
