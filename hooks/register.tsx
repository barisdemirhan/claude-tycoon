import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { TycoonSave, TycoonSettings } from '../types'
import { fieldOf, toSave, toSettings } from './bank'
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
  perksOf,
  rankOf,
  rateOf,
  salaried,
  settled,
  shipped,
  upgraded,
  upgradedAll,
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
const SAVE = 'save'
const SETTINGS = 'settings'
// The rows the game's screen wants: fewer on a wide pane, where its stage
// stands beside its shop, and more docked, where the pane is as tall as the
// terminal. It takes no more than the pane's body shows beside the keys
// field and the hint, so those two stay in view.
const WIDE_ROWS = 14
const TALL_ROWS = 22
const DOCK_ROWS = 28
const MIN_ROWS = 10
const FIELD_ROWS = 2
const PULSE_MS = 5000
// Clicks by hand are paid together, this long after the first of them.
const MINE_MS = 200
// A gap this long between two settles is told as time away.
const AWAY_MS = 10 * 60_000
// A streak is shown while a call could still build on it.
const STREAK_SHOWS_MS = 60_000
const TOOL_WIDTH = 16
// Cells kept clear after the balance: the hint line draws marks its text
// does not count, and a tail that overruns the row is cut.
const HINT_MARGIN = 6
const HINT_GAP = 2
const USAGE =
  'Usage: /tycoon [play], /tycoon stop, /tycoon stats, /tycoon hint [on|off] or /tycoon reset confirm.'
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

// The changes to the save, one after another: Claude's calls come in
// parallel, and each change reads the store before it writes it.
let queue: Promise<unknown> = Promise.resolve()
// What tells the open pane to draw again; nothing beats with the pane shut.
let beat: Timer | undefined
// Clicks by hand not yet paid, and what pays them.
let unpaid = 0
let payday: Timer | undefined

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
  await update($, input, now => ({ ...now, typed: now.typed + 1 }))
  await pressed($, (value.at(-1) ?? '').toLowerCase())
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
    ? 'The balance shows at the end of the hint line under the prompt.'
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tycoon',
      description: "Run a token business on Claude's tool calls, in a pane",
      argumentHint: '[play|stop|stats|hint|reset]',
    })
    const saved = toSettings(await $.store.get(SETTINGS))
    await update($, settings, () => saved)
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

    if (word !== '') {
      return { text: USAGE }
    }

    if (verb === 'stats') {
      return { text: statsText((await commit($, save => save)).after) }
    }

    if (verb === 'stop') {
      beat?.cancel()
      await update($, view, now => ({ ...now, isOpen: false }))
      await $.ui.close({ id: PANE })

      return { text: 'Tycoon is closed, and still earns. /tycoon opens it again.' }
    }

    if (!PLAY_WORDS.includes(verb)) {
      return { text: USAGE }
    }

    await commit($, save => save)
    await update($, view, now => ({ ...now, isOpen: true, isArmed: false }))
    beating($)
    const opened = await $.ui.open({
      id: PANE,
      title: 'Token Tycoon',
      focus: true,
      rows:
        (e.presentation.columns >= WIDE_FROM ? WIDE_ROWS : TALL_ROWS) + FIELD_ROWS,
    })

    return {
      text: opened.isPlaced
        ? "Tycoon is open: Claude's tool calls earn tokens, 1-9 buy, space mines by hand."
        : `Tycoon is open but has no room to show: ${opened.reason}`,
    }
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
      await commit($, save => salaried(save, written)).catch(() => undefined)
    }

    return next(e)
  })

  // The balance at the end of the hint line under the prompt, where it shows
  // with the pane closed and takes no row of its own. The hint's text is the
  // engine's to draw: this only adds to its tail.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const kept = await read($, bank)

    if (kept === null || kept.lifeEarned === 0 || !(await read($, settings)).hasHint) {
      return next(e)
    }

    const save = settled(kept, await $.clock.now())
    const label = `◈ ${short(save.tokens)} +${short(rateOf(save))}/s`
    const tail = tailed(
      e.props.hint,
      e.props.tail ?? '',
      label,
      e.viewport?.columns ?? 0,
    )

    return next({ ...e, props: { ...e.props, tail } })
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
          {body(ui, props.save, props.view, key => void pressed($, key))}
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
        <ui.Input
          key={KEYS}
          label="keys"
          submitLabel="mine"
          value={typed % 2 === 0 ? '' : ' '}
          autoFocus
          onInput={value => keyed($, value)}
          onSubmit={() => pressed($, ' ')}
        />
        <ui.Text dimColor>
          {e.props.isFocused
            ? 'space mine · 1-9 buy · g u r p tabs · esc leaves'
            : 'ctrl+x tab gives the game the keys · a click buys'}
        </ui.Text>
      </ui.Box>
    )
  })
}
