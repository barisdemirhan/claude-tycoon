import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TycoonBoard, TycoonSave, TycoonSettings } from '../types'
import { fieldOf, toSave, toSettings } from './bank'
import {
  NOBODY,
  NO_BOARD,
  SILENT,
  boardOf,
  enrolled,
  nameText,
  named,
  pageOf,
  placed,
  posted,
  ranked,
  refusalOf,
  saveBody,
  sentText,
  toPlayer,
  topPath,
  topText,
  urlOf,
} from './board'
import type { Player, Told } from './board'
import { counted, short, span } from './format'
import type { GameProps } from './game'
import { body } from './pane'
import { WIDE_FROM, actionOf, percent, qtyAfter } from './screen'
import {
  FEAT_BONUS,
  WEIGHT_BONUS,
  bought,
  called,
  clicked,
  comboAfter,
  familyOf,
  featsDue,
  fresh,
  honored,
  openUpgrades,
  perksOf,
  rankOf,
  rateOf,
  salaried,
  settled,
  shipped,
  upgraded,
  upgradedAll,
  weightsDue,
  windowLeft,
} from './sim'

type Change = (
  save: TycoonSave,
  now: number,
) => TycoonSave | Promise<TycoonSave>
// A change as it went through: the save as the store had it, as it stood
// settled before the change, and as it was written after it.
type Committed = {
  kept: TycoonSave
  before: TycoonSave
  after: TycoonSave
  isChanged: boolean
}
type Press = { seq: number; key: string }

const PANE = 'tycoon'
const GAME = 'game'
const KEYS = 'keys'
const TOGGLE = 'toggle'
const SAVE = 'save'
const SETTINGS = 'settings'
const PLAYER = 'player'
// The rows the game's screen wants: fewer on a wide pane, where its stage
// stands beside its shop, and more docked, where the pane is as tall as the
// terminal. It takes no more than the pane's body shows beside the keys
// field and the hint, so those two stay in view.
const WIDE_ROWS = 14
const TALL_ROWS = 23
const DOCK_ROWS = 28
const MIN_ROWS = 10
const FIELD_ROWS = 2
const PULSE_MS = 5000
// Clicks by hand are paid together, this long after the first of them.
const MINE_MS = 200
// A gap this long between two settles is told as time away.
const AWAY_MS = 10 * 60_000
// A save goes up to the global top by itself no more often than this, and
// before the board is looked at, no more often than that.
const SEND_EVERY_MS = 10 * 60_000
const PEEK_EVERY_MS = 60_000
// A streak is shown while a call could still build on it.
const STREAK_SHOWS_MS = 60_000
const TOOL_WIDTH = 16
// Cells kept clear after the balance: the hint line draws marks its text
// does not count, and a tail that overruns the row is cut.
const HINT_MARGIN = 6
const HINT_GAP = 2
// What the hint line draws beside its text, as cells: the indent it starts
// at, and the pills its text does not hold.
const HINT_INDENT = 2
const HINT_PILLS = 18
const USAGE =
  'Usage: /tycoon [play], /tycoon stop, /tycoon stats, /tycoon top [page], /tycoon name [<name>|off], /tycoon leave, /tycoon hint [on|off] or /tycoon reset confirm.'
const PLAY_WORDS = ['', 'play']
const SWITCH: Readonly<Record<string, boolean>> = { on: true, off: false }

const bank = atom({ plugin: 'tycoon', key: 'bank' } as const, null)
const view = atom({ plugin: 'tycoon', key: 'view' } as const, {
  tab: 'build',
  qty: 1,
  isArmed: false,
  isOpen: false,
})
const combo = atom({ plugin: 'tycoon', key: 'combo' } as const, {
  level: 1,
  at: 0,
})
const feed = atom({ plugin: 'tycoon', key: 'feed' } as const, {
  gain: 0,
  tool: '',
  calls: 0,
  mines: 0,
})
const input = atom({ plugin: 'tycoon', key: 'input' } as const, {
  typed: 0,
  acked: 0,
})
const settings = atom({ plugin: 'tycoon', key: 'settings' } as const, {
  hasHint: true,
})
const pulse = atom({ plugin: 'tycoon', key: 'pulse' } as const, 0)
// The global top as last fetched for the game to show, the person's name and
// place on it, and whether the keys field is asking for that name.
const board = atom({ plugin: 'tycoon', key: 'board' } as const, NO_BOARD)
const standing = atom({ plugin: 'tycoon', key: 'standing' } as const, {
  name: '',
  rank: 0,
})
const ask = atom({ plugin: 'tycoon', key: 'ask' } as const, {
  isAsked: false,
  isShut: false,
})

// The changes to the save, one after another: Claude's calls come in
// parallel, and each change reads the store before it writes it.
let queue: Promise<unknown> = Promise.resolve()
// What tells the open pane to draw again; nothing beats with the pane shut.
let beat: Timer | undefined
// Clicks by hand not yet paid, and what pays them.
let unpaid = 0
let payday: Timer | undefined
// What the leaderboard has refused a save with this session: each is said once.
const refused = new Set<string>()

const toPresses = (data: unknown): Press[] => {
  const keys = fieldOf(data, 'keys')

  return Array.isArray(keys)
    ? keys.flatMap(one => {
        const seq = fieldOf(one, 'seq')
        const key = fieldOf(one, 'key')

        return typeof seq === 'number' && typeof key === 'string' ? [{ seq, key }] : []
      })
    : []
}

/** The save a drawing reads: the session's copy, or the store's before any. */
const savedAt = async ($: EngineInterface, now: number): Promise<TycoonSave> =>
  (await read($, bank)) ?? toSave(await $.store.get(SAVE), now)

/** The streak's times at `now`: 1 once a call could no longer build on it. */
const streakAt = async ($: EngineInterface, now: number): Promise<number> => {
  const streak = await read($, combo)

  return now - streak.at <= STREAK_SHOWS_MS ? streak.level : 1
}

/** Everything the game's screen draws from, as its props. */
const gameProps = async ($: EngineInterface): Promise<GameProps> => {
  const now = await $.clock.now()
  const kept = await savedAt($, now)
  const { acked } = await read($, input)

  return {
    save: settled(kept, now),
    stamp: now,
    leftMs: windowLeft(kept, now),
    view: await read($, view),
    streak: await streakAt($, now),
    ...(await read($, feed)),
    acked,
    board: await read($, board),
    standing: await read($, standing),
    isAsked: (await read($, ask)).isAsked,
  }
}

/** The line under the balance where no screen is drawn: rank, window, streak, pay. */
const noteOf = (props: GameProps): string =>
  [
    rankOf(props.save.ships),
    rateOf(props.save) === 0
      ? ''
      : props.leftMs === 0
        ? 'the context window ran out'
        : `runs ${span(props.leftMs)} more unattended`,
    props.streak > 1 ? `streak ×${props.streak.toFixed(1)}` : '',
    props.gain > 0 ? `+${short(props.gain)} ${props.tool}` : '',
  ]
    .filter(part => part !== '')
    .join(' · ')

const statsText = (save: TycoonSave): string => {
  const { stats } = save

  return [
    `Tycoon: ◈${short(save.tokens)} · +${short(rateOf(save))}/s`,
    `${rankOf(save.ships)}, ${counted(save.weights, 'weight')} (+${percent(save.weights * WEIGHT_BONUS)})`,
    `${counted(stats.calls, 'call')}, ${stats.fails} failed`,
    `${counted(stats.bought, 'generator')} bought`,
    counted(save.upgrades.length, 'upgrade'),
    `${counted(save.feats.length, 'achievement')} (+${percent(save.feats.length * FEAT_BONUS)})`,
    `◈${short(save.lifeEarned)} earned in all`,
  ].join(' · ')
}

/**
 * The balance worked into the hint line's tail. A tail another mod already
 * padded out to the row's end gives up that much of its padding; with no
 * such room the balance follows the line, or is left out when the row is full.
 */
const tailed = (
  hint: string,
  tail: string,
  label: string,
  columns: number,
): string => {
  const gap = ' '.repeat(HINT_GAP)
  const padding = ' '.repeat(label.length + HINT_GAP * 2)

  if (tail.includes(padding)) {
    return tail.replace(padding, `${gap}${label}${gap}`)
  }

  const room = columns - hint.length - tail.length - label.length

  return room >= HINT_GAP + HINT_MARGIN ? `${tail}${gap}${label}` : tail
}

const queued = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job)
  queue = run.catch(() => undefined)

  return run
}

/**
 * Reads the save from the store, settles it, changes it, gives it the
 * feats it has earned and writes it back, for the session to draw from.
 */
const commit = ($: EngineInterface, change: Change): Promise<Committed> =>
  queued(async () => {
    const now = await $.clock.now()
    const kept = toSave(await $.store.get(SAVE), now)
    const before = settled(kept, now)
    const changed = await change(before, now)
    const earned = featsDue(changed)
    const after = honored(changed)
    await $.store.set(SAVE, after)
    await update($, bank, () => after)

    // A toast is a box forty cells wide: one name fits it, a list does not.
    if (earned.length > 0) {
      $.ui.toast(
        earned.length === 1
          ? `Tycoon · ${earned[0]?.name ?? ''} · +${percent(FEAT_BONUS)}`
          : `Tycoon · ${earned.length} achievements`,
      )
    }

    return { kept, before, after, isChanged: changed !== before }
  })

/** A tool call of Claude's, paid by its family and the streak it adds to. */
const earn = async (
  $: EngineInterface,
  tool: string,
  isFailed: boolean,
): Promise<void> => {
  const { before, after } = await commit($, async (save, now) => {
    const streak = await update($, combo, kept =>
      comboAfter(kept, now, perksOf(save).cap),
    )

    return called(save, familyOf(tool), isFailed, streak.level)
  })
  const name = (tool.split('__').at(-1) ?? '').slice(0, TOOL_WIDTH)
  await update($, feed, now => ({
    ...now,
    gain: after.tokens - before.tokens,
    tool: name,
    calls: now.calls + 1,
  }))
}

const playerOf = async ($: EngineInterface): Promise<Player> =>
  toPlayer(await $.store.get(PLAYER))

/** Keeps the player, and hands the game their name and place to show. */
const filed = async ($: EngineInterface, player: Player): Promise<void> => {
  await $.store.set(PLAYER, player)
  await update($, standing, () => ({ name: player.name, rank: player.rank }))
}

/**
 * Asks the leaderboard's server, and answers its status and what it said:
 * status 0 when it could not be reached or said nothing a board would say.
 */
const asked = async (
  $: EngineInterface,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; said: unknown }> => {
  try {
    const { status, text } = await $.http.fetch(
      urlOf(path),
      body === undefined ? undefined : posted(body),
    )
    const said: unknown = JSON.parse(text)

    return { status, said }
  } catch {
    return { status: 0, said: undefined }
  }
}

/**
 * Sends the save for the server to read with the game's rules and count.
 * Answers the player as the board has them now, or what the server refused with.
 */
const submitted = async ($: EngineInterface, save: TycoonSave): Promise<Player | string> => {
  const player = await playerOf($)
  const { status, said } = await asked($, '/saves', saveBody(player, save))

  if (status !== 200) {
    return refusalOf(said)
  }

  const after = { ...ranked(player, said), sentAt: await $.clock.now() }
  await filed($, after)

  return after
}

/**
 * Sends the save by itself, when this person is on the global top, it has
 * earned more than the board has from them, and the last one went `gap` ago
 * or longer. A toast says so when it moved them up, and the first time one
 * is held back or refused.
 */
const reported = async (
  $: EngineInterface,
  save: TycoonSave,
  gap: number,
): Promise<void> => {
  const before = await playerOf($)
  const now = await $.clock.now()

  if (before.name === '' || save.lifeEarned <= before.best || now - before.sentAt < gap) {
    return
  }

  // Marked before the server is asked: another session may be at the same.
  await $.store.set(PLAYER, { ...before, sentAt: now })
  const after = await submitted($, save)

  if (typeof after === 'string') {
    if (after !== SILENT && !refused.has(after)) {
      refused.add(after)
      $.ui.toast(after)
    }

    return
  }

  const isUp = after.rank > 0 && (before.rank === 0 || after.rank < before.rank)

  if (isUp || (after.isHeld && !before.isHeld)) {
    $.ui.toast(
      after.isHeld
        ? 'Tycoon · save held to be looked over'
        : `Tycoon · #${after.rank} on the global top`,
    )
  }
}

/**
 * Takes `name` on the global top for this person, or changes the name they
 * have there, and sends the save as it stands. The first time, it makes the
 * id and the secret their saves go under, and keeps them once the server has
 * taken the name.
 */
const join = async ($: EngineInterface, name: string): Promise<Told> => {
  const player = enrolled(await playerOf($))
  const { status, said } = await asked($, '/players', {
    id: player.id,
    key: player.key,
    name,
  })

  if (status !== 200) {
    return { isDone: false, text: refusalOf(said) }
  }

  const taken = named(player, said)
  await filed($, taken)
  const { after: save } = await commit($, kept => kept)
  const welcome = `You are on the global top as ${taken.name}.`

  if (save.lifeEarned <= taken.best) {
    return { isDone: true, text: `${welcome} What you earn goes up from here on.` }
  }

  const after = await submitted($, save)

  return {
    isDone: true,
    text: `${welcome} ${typeof after === 'string' ? after : sentText(after)}`,
  }
}

/** `/tycoon leave`: takes this person and their save off the global top. */
const leftText = async ($: EngineInterface): Promise<string> => {
  const player = await playerOf($)

  if (player.name === '') {
    return 'You are not on the global top.'
  }

  const { status, said } = await asked($, '/leave', {
    id: player.id,
    key: player.key,
  })

  // A player the server no longer knows is as gone as one it just removed.
  if (status !== 200 && status !== 403) {
    return refusalOf(said)
  }

  await filed($, { ...NOBODY, isOff: true })
  // The page the game last showed had them on it.
  await update($, board, () => NO_BOARD)

  return 'You are off the global top, and your save there is deleted.'
}

/** `/tycoon name off`: the top tab stops asking for a name. */
const declinedText = async ($: EngineInterface): Promise<string> => {
  const player = await playerOf($)

  if (player.name !== '') {
    return `You are on the global top as ${player.name}. /tycoon leave takes you off it.`
  }

  await $.store.set(PLAYER, { ...player, isOff: true })
  await update($, ask, now => ({ ...now, isAsked: false }))

  return 'Tycoon will not ask for a name again. /tycoon name <name> joins the global top.'
}

/**
 * Fetches a page of the global top for the game to show. What it showed
 * before stays up while the server is asked, and after a silence.
 */
const boarded = async ($: EngineInterface, page: number): Promise<void> => {
  await update($, board, (now): TycoonBoard => ({ ...now, state: 'asking' }))
  const { status, said } = await asked($, topPath(await playerOf($), page))
  const fetched = boardOf(status, said)

  if (fetched === undefined) {
    await update($, board, (now): TycoonBoard => ({ ...now, state: 'silent' }))

    return
  }

  await update($, board, () => fetched)
  const player = await playerOf($)

  if (player.name !== '') {
    await filed($, placed(player, said))
  }
}

/** The board's first page, with this person's own save sent ahead of it. */
const peeked = async ($: EngineInterface): Promise<void> => {
  await reported($, (await commit($, save => save)).after, PEEK_EVERY_MS)
  await boarded($, 1)
}

/**
 * The top tab came into view: the board is fetched, and somebody who is not
 * on it, and has not put the question away, is asked for a name.
 */
const topOpened = async ($: EngineInterface): Promise<void> => {
  const { name, isOff } = await playerOf($)
  await update($, ask, now => ({
    ...now,
    isAsked: name === '' && !isOff && !now.isShut,
  }))
  void peeked($).catch(() => undefined)
}

/** The name key: asks somebody not on the global top for a name, and tells the others theirs. */
const nameAsked = async ($: EngineInterface): Promise<void> => {
  const player = await playerOf($)

  if (player.name === '') {
    await update($, ask, now => ({ ...now, isAsked: true }))
  } else {
    $.ui.toast(nameText(player))
  }
}

/** Something the person bought: a toast says so when the balance did not cover it. */
const spend = async ($: EngineInterface, change: Change): Promise<void> => {
  const { isChanged } = await commit($, change)

  if (!isChanged) {
    $.ui.toast('Tycoon · not enough tokens yet')
  }
}

/** The ship key: the first press arms it, the second gives the run up. */
const shipIt = async ($: EngineInterface): Promise<void> => {
  const { isArmed } = await read($, view)

  if (!isArmed) {
    await update($, view, now => ({ ...now, isArmed: true }))

    return
  }

  const { before, after, isChanged } = await commit($, save => shipped(save))
  await update($, view, now => ({
    ...now,
    isArmed: false,
    tab: 'build' as const,
  }))

  if (isChanged) {
    $.ui.toast(
      `Tycoon · ${rankOf(after.ships)} shipped · +${counted(after.weights - before.weights, 'weight')}`,
    )
    // The board shows the new rank beside the name.
    void reported($, after, 0).catch(() => undefined)
  }
}

/** A click by hand: shown at once, and paid with the others of its moment. */
const mined = ($: EngineInterface): void => {
  unpaid += 1
  void update($, feed, now => ({ ...now, mines: now.mines + 1 }))
  payday ??= $.clock.after(MINE_MS, () => {
    const count = unpaid
    payday = undefined
    unpaid = 0
    void commit($, save => clicked(save, count)).catch(() => undefined)
  })
}

/** A key of the game's, from the field, the screen or a button: what it means in the tab in view, done. */
const pressed = async ($: EngineInterface, key: string): Promise<void> => {
  const now = await $.clock.now()
  const seen = await read($, view)
  const action = actionOf(key, settled(await savedAt($, now), now), seen)

  switch (action?.kind) {
    case 'tab':
      await update($, view, kept => ({ ...kept, tab: action.tab, isArmed: false }))

      if (action.tab === 'top') {
        await topOpened($)
      } else {
        await update($, ask, kept => ({ ...kept, isAsked: false }))
      }

      break
    case 'page':
      void boarded($, action.page).catch(() => undefined)
      break
    case 'name':
      await nameAsked($)
      break
    case 'qty':
      await update($, view, kept => ({ ...kept, qty: qtyAfter(kept.qty) }))
      break
    case 'mine':
      mined($)
      break
    case 'buy':
      await spend($, save => bought(save, action.id, seen.qty))
      break
    case 'upgrade':
      await spend($, save => upgraded(save, action.id))
      break
    case 'upgradeAll':
      await spend($, save => upgradedAll(save))
      break
    case 'ship':
      await shipIt($)
      break
    case undefined:
      break
  }
}

/**
 * A change of the keys field: the key typed last is one press, and counting
 * it draws the field with another value, which empties it for the next.
 */
const keyed = async ($: EngineInterface, value: string): Promise<void> => {
  // While a name is asked for, the field takes the name and presses nothing.
  if ((await read($, ask)).isAsked) {
    return
  }

  await update($, input, now => ({ ...now, typed: now.typed + 1 }))
  await pressed($, (value.at(-1) ?? '').toLowerCase())
}

/**
 * Enter in the keys field: a click by hand. While a name is asked for, the
 * name joins the global top, and enter alone puts the question away.
 */
const entered = async ($: EngineInterface, value: string): Promise<void> => {
  const name = value.trim()

  if (!(await read($, ask)).isAsked) {
    await pressed($, ' ')

    return
  }

  const told = name === '' ? undefined : await join($, name)

  if (told !== undefined) {
    $.ui.toast(told.text)
  }

  if (told === undefined || told.isDone) {
    await update($, ask, () => ({ isAsked: false, isShut: true }))
    // A key that is no press: it only empties the field of the name.
    await update($, input, now => ({ ...now, typed: now.typed + 1 }))
  }

  if (told?.isDone === true) {
    void boarded($, 1).catch(() => undefined)
  }
}

/** The presses the game's screen posted that were not acted on yet, acted on in order. */
const heard = async ($: EngineInterface, data: unknown): Promise<void> => {
  const sent = toPresses(data)
  let due: Press[] = []
  await update($, input, now => {
    due = sent.filter(one => one.seq > now.acked)

    return { ...now, acked: Math.max(now.acked, ...sent.map(one => one.seq)) }
  })

  for (const one of due) {
    await pressed($, one.key)
  }
}

/** Brings the session's copy up to the store's, and the open pane with it. */
const pulsed = ($: EngineInterface): Promise<void> =>
  queued(async () => {
    const now = await $.clock.now()
    const kept = toSave(await $.store.get(SAVE), now)
    await update($, bank, () => kept)
    await update($, pulse, () => now)
  })

const beating = ($: EngineInterface): void => {
  beat?.cancel()
  beat = $.clock.every(PULSE_MS, () => void pulsed($).catch(() => undefined))
}

/** Changes a setting for this session and keeps it for the next ones. */
const stored = async (
  $: EngineInterface,
  change: Partial<TycoonSettings>,
): Promise<TycoonSettings> => {
  const next = await update($, settings, now => ({ ...now, ...change }))
  await $.store.set(SETTINGS, next)

  return next
}

/** `/tycoon hint [on|off]`: the word's way, or the other way with no word. */
const hintText = async ($: EngineInterface, word: string): Promise<string> => {
  const hasHint =
    word === '' ? !(await read($, settings)).hasHint : SWITCH[word]

  if (hasHint === undefined) {
    return USAGE
  }

  await stored($, { hasHint })

  return hasHint
    ? 'The balance shows on the hint line under the prompt: a click on it opens and closes the game.'
    : 'The balance is off the hint line.'
}

/** `/tycoon reset confirm`: the save is deleted and the game begins again. */
const resetText = ($: EngineInterface): Promise<string> =>
  queued(async () => {
    const now = await $.clock.now()
    await $.store.delete(SAVE)
    await update($, bank, () => fresh(now))
    await update($, combo, () => ({ level: 1, at: 0 }))
    await update($, feed, kept => ({ ...kept, gain: 0, tool: '' }))

    return 'Tycoon is reset: the balance, the generators, the upgrades, the weights and the achievements are gone.'
  })

/** Opens the pane, as `/tycoon` does, and says whether it found room. */
const shown = async ($: EngineInterface, columns: number): Promise<string> => {
  await commit($, save => save)
  await update($, view, now => ({ ...now, isOpen: true, isArmed: false }))
  beating($)
  const opened = await $.ui.open({
    id: PANE,
    title: 'Token Tycoon',
    focus: true,
    rows: (columns >= WIDE_FROM ? WIDE_ROWS : TALL_ROWS) + FIELD_ROWS,
  })

  return opened.isPlaced
    ? "Tycoon is open: Claude's tool calls earn tokens, 1-9 buy, space mines by hand."
    : `Tycoon is open but has no room to show: ${opened.reason}`
}

/** Closes the pane, as `/tycoon stop` does: the game goes on earning. */
const hidden = async ($: EngineInterface): Promise<void> => {
  beat?.cancel()
  await update($, view, now => ({ ...now, isOpen: false }))
  await $.ui.close({ id: PANE })
}

/** A click on the balance under the prompt: the pane opens, or closes. */
const toggled = async ($: EngineInterface, columns: number): Promise<void> => {
  if ((await read($, view)).isOpen) {
    await hidden($)
  } else {
    await shown($, columns)
  }
}

/**
 * The balance as the footer under the prompt shows it, with what waits on
 * the person: the upgrades the balance covers, a ship that is due, and their
 * place on the global top. Undefined before anything is earned, and while
 * `/tycoon hint off` stands.
 */
const footerLabel = async ($: EngineInterface): Promise<string | undefined> => {
  const kept = await read($, bank)

  if (kept === null || kept.lifeEarned === 0 || !(await read($, settings)).hasHint) {
    return undefined
  }

  const save = settled(kept, await $.clock.now())
  const open = openUpgrades(save).filter(upgrade => upgrade.cost <= save.tokens)
  const { rank } = await read($, standing)

  return [
    `◈ ${short(save.tokens)} +${short(rateOf(save))}/s`,
    ...(open.length === 0 ? [] : [`↑${open.length}`]),
    ...(weightsDue(save) === 0 ? [] : ['ship']),
    ...(rank === 0 ? [] : [`#${rank}`]),
  ].join(' · ')
}

/** The line under the keys field: what the keys do, or what a name does. */
const hintOf = (isAsked: boolean, isFocused: boolean): string => {
  if (isAsked) {
    return 'enter joins the global top under this name · enter alone leaves it for now'
  }

  return isFocused
    ? 'space mine · 1-9 buy · g u r p t tabs · esc leaves'
    : 'ctrl+x tab gives the game the keys · a click buys'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tycoon',
      description: "Run a token business on Claude's tool calls, in a pane",
      argumentHint: '[play|stop|stats|top|name|leave|hint|reset]',
    })
    const saved = toSettings(await $.store.get(SETTINGS))
    const { name, rank } = await playerOf($)
    await update($, settings, () => saved)
    await update($, standing, () => ({ name, rank }))
    const { kept, before } = await commit($, save => save)
    const made = before.tokens - kept.tokens

    if (e.isInteractive && before.at - kept.at >= AWAY_MS && made > 0) {
      $.ui.toast(`Tycoon · made ◈${short(made)} while away`)
    }

    // A reload starts the module over while its pane stays open.
    if ((await read($, view)).isOpen) {
      beating($)
    }

    return next(e)
  })

  on('command.run', { command: 'tycoon' }, async ($, e) => {
    const [verb = '', word = '', ...rest] = e.args
      .trim()
      .toLowerCase()
      .split(/\s+/)

    if (rest.length > 0) {
      return { text: USAGE }
    }

    if (verb === 'hint') {
      return { text: await hintText($, word) }
    }

    if (verb === 'reset') {
      return {
        text:
          word === 'confirm'
            ? await resetText($)
            : 'This deletes the whole save, weights and achievements included. /tycoon reset confirm does it.',
      }
    }

    if (verb === 'name' && word === 'off') {
      return { text: await declinedText($) }
    }

    if (verb === 'name' && word !== '') {
      // The name as typed: the words above are lowered to match commands.
      const told = await join($, e.args.trim().split(/\s+/)[1] ?? '')

      if (told.isDone) {
        await update($, ask, now => ({ ...now, isAsked: false }))
      }

      return { text: told.text }
    }

    if (verb === 'top') {
      const page = pageOf(word)

      if (page === undefined) {
        return { text: USAGE }
      }

      await reported($, (await commit($, save => save)).after, PEEK_EVERY_MS)
      const { status, said } = await asked($, topPath(await playerOf($), page))

      return { text: topText(status, said) }
    }

    if (word !== '') {
      return { text: USAGE }
    }

    if (verb === 'name') {
      return { text: nameText(await playerOf($)) }
    }

    if (verb === 'leave') {
      return { text: await leftText($) }
    }

    if (verb === 'stats') {
      return { text: statsText((await commit($, save => save)).after) }
    }

    if (verb === 'stop') {
      await hidden($)

      return { text: 'Tycoon is closed, and still earns. /tycoon opens it again.' }
    }

    if (!PLAY_WORDS.includes(verb)) {
      return { text: USAGE }
    }

    return { text: await shown($, e.presentation.columns) }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== GAME) {
      return next(e)
    }

    await heard($, e.data)

    return { props: await gameProps($) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      beat?.cancel()
      await update($, view, now => ({ ...now, isOpen: false }))
    }

    return next(e)
  })

  // Every tool call Claude makes is paid. The call itself is passed on and
  // answered untouched: only its name and whether it failed are read, and a
  // call that was refused pays nothing.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined) {
      // A game that cannot save must not fail the call it only watched.
      await earn($, String(e.tool), ran.isError === true).catch(() => undefined)
    }

    return ran
  })

  // The end of a turn is paid by the output tokens it really cost: a count,
  // and nothing of what the turn said.
  on('turn.complete', async ($, e, next) => {
    const written = e.usage?.output_tokens

    if (!e.isAborted && written !== undefined) {
      const paid = await commit($, save => salaried(save, written)).catch(
        () => undefined,
      )

      // What was earned goes up to the global top, for somebody who is on it.
      if (paid !== undefined) {
        void reported($, paid.after, SEND_EVERY_MS).catch(() => undefined)
      }
    }

    return next(e)
  })

  // The balance on the hint line under the prompt, where it shows with the
  // pane closed and takes no row of its own. Where a click can reach it, it
  // is a button at the row's end that opens the pane and closes it, drawn
  // over the engine's line, which stays as it came with what other mods
  // added to it. Where no click can, or the row is too short, it is text at
  // the line's end, as the engine draws a tail.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const label = await footerLabel($)

    if (label === undefined) {
      return next(e)
    }

    const columns = e.viewport?.columns ?? 0
    const drawn = `${e.props.hint}${e.props.tail ?? ''}`
    const left = columns - label.length - HINT_MARGIN
    const hasPointer = e.surface !== 'terminal' || e.viewport?.isFullscreen === true

    if (!hasPointer || left < HINT_INDENT + drawn.length + HINT_PILLS) {
      const tail = tailed(e.props.hint, e.props.tail ?? '', label, columns)

      return next({ ...e, props: { ...e.props, tail } })
    }

    const line = await next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box>
        {line}
        {/* The engine draws its line on the row over the tree's own first:
            one row up is that line's row. */}
        <Box position="absolute" top={-1} left={left}>
          <Button
            key={TOGGLE}
            plain
            dimColor
            label={label}
            onPress={() => toggled($, columns)}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // The beat's own value is not drawn: reading it is what draws this again.
    await read($, pulse)
    const props = await gameProps($)

    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const ui = $.ui.resolve(e)

      return (
        <ui.Box flexDirection="column">
          <ui.Text bold>
            ◈ {short(props.save.tokens)} +{short(rateOf(props.save))}/s
          </ui.Text>
          <ui.Text dimColor>{noteOf(props)}</ui.Text>
          {body(
            ui,
            props.save,
            props.view,
            key => void pressed($, key),
            props.board,
            props.standing,
          )}
        </ui.Box>
      )
    }

    const ui = $.ui.resolve(e)
    const { typed } = await read($, input)
    const wanted =
      e.props.placement === 'dock'
        ? DOCK_ROWS
        : e.props.bodyColumns >= WIDE_FROM
          ? WIDE_ROWS
          : TALL_ROWS
    const rows = Math.min(
      wanted,
      Math.max(MIN_ROWS, e.props.scroll.bodyRows - FIELD_ROWS),
    )

    return (
      <ui.Box flexDirection="column">
        <ui.Client
          key={GAME}
          module="./game.tsx"
          props={props}
          width="100%"
          height={rows}
        />
        {/* The field is the keyboard: every key typed into it is one press, and
            drawing a value other than the last one empties it again. */}
        {/* On the top tab, for somebody not on the global top, the same field
            asks for a name: it keeps the focus, and enter alone puts it away. */}
        <ui.Input
          key={KEYS}
          label={props.isAsked ? 'name' : 'keys'}
          placeholder={props.isAsked ? 'a name for the global top' : undefined}
          submitLabel={props.isAsked ? 'join' : 'mine'}
          value={typed % 2 === 0 ? '' : ' '}
          autoFocus
          onInput={value => keyed($, value)}
          onSubmit={value => entered($, value)}
        />
        <ui.Text dimColor>{hintOf(props.isAsked, e.props.isFocused)}</ui.Text>
      </ui.Box>
    )
  })
}
