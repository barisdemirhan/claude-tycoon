import type { ClientModule, ClientSurface } from 'claude-code'

import type { TycoonSave, TycoonView } from '../types'
import {
  ART,
  COIN,
  COIN_PALETTE,
  DIGITS,
  DIGIT_HEIGHT,
  GEM,
  GEM_PALETTE,
  GOLD,
  GREEN,
  ORANGE,
  RED,
  SLATE,
  SPARK,
  SPARK_LIT,
  SPARK_PALETTE,
  WHITE,
} from './art'
import type { Art, Palette } from './art'
import {
  BOLD,
  DIM,
  FG,
  INVERSE,
  blit,
  canvasOf,
  dot,
  rowsOf,
  shade,
  stamp,
  write,
} from './canvas'
import type { Canvas } from './canvas'
import { grouped, price, short, span } from './format'
import {
  ALL_KEY,
  QTY_KEY,
  ROW_KEYS,
  SHIP_KEY,
  TABS,
  WIDE_FROM,
  generatorRows,
  recordLines,
  shipLabel,
  shipLines,
  upgradeRows,
} from './screen'
import type { Line } from './screen'
import {
  clickOf,
  openUpgrades,
  perksOf,
  priceOf,
  rankOf,
  rateOf,
  weightsDue,
  yieldOf,
} from './sim'

/** Everything the screen draws from, as the hooks module hands it. */
export type GameProps = {
  // The save, settled at `stamp`.
  save: TycoonSave
  stamp: number
  // How much longer the generators run from `stamp` on.
  leftMs: number
  view: TycoonView
  // The streak's times now: 1 when no streak is on.
  streak: number
  // What the latest call paid and the tool that earned it, with how many
  // calls and clicks by hand this session has counted.
  gain: number
  tool: string
  calls: number
  mines: number
  // The last press of this screen's the hooks module has acted on.
  acked: number
}

// A coin on its way up, with what it says beside it.
type Coin = { x: number; age: number; text: string }
type Press = { seq: number; key: string }
// A stretch of cells that takes a click as a key.
type Hit = { x: number; row: number; wide: number; key: string }
type Game = {
  // Every tick of the clock, drawn or not, and the one the props came at.
  beats: number
  base: number
  stamp: number
  // The beat the generators stop at if nothing settles the save before.
  until: number
  calls: number
  mines: number
  coins: Coin[]
  // Beats the spark stays lit after a call.
  glow: number
  // Beats since anything happened: a quiet screen is drawn less often.
  calm: number
  seq: number
  pending: Press[]
  hits: Hit[]
}
type Frame = {
  game: Game
  props: GameProps
  // The save with what the generators made since the props came.
  live: TycoonSave
  rate: number
  isAsleep: boolean
  hits: Hit[]
}

const TICK_MS = 120
const MAX_COLUMNS = 140
const MIN_COLUMNS = 36
const MIN_ROWS = 10
// Beside the shop, the stage is this wide at most.
const STAGE_WIDE = 52
const HUD_ROWS = 3
// Stacked over the shop, the scene is this tall where the screen spares it,
// the shop keeping this many rows; a scene shorter than its least is left out.
const STAGE_SCENE_ROWS = 6
const MIN_SCENE_ROWS = 4
const SHOP_ROWS = 11
// The sky is the scene less this many pixels of what stands on the ground.
const SKYLINE = 9
const MIN_SKY = 3
// Cells kept clear at the right: the pane draws its close mark there.
const EDGE = 2
const CALM_BEATS = 80
const CALM_EVERY = 4
const GLOW_BEATS = 4
const COIN_BEATS = 9
const MOST_COINS = 4
const MOST_PENDING = 16
const BLINK_BEATS = 5
const STAR_EVERY = 7
const SPARK_X = 2
const FIRST_X = 10
const SPRITE_GAP = 2
const ALOFT_EVERY = 10
// What an unlit scene keeps of its colors.
const ASLEEP_SHADE = 0.4
const DIGIT_X = 7
const NAME_WIDE = 17
const UPGRADE_WIDE = 22
const OWNED_WIDE = 5
const EACH_WIDE = 12
const COST_WIDE = 10
const NOTE_WIDE = 58
const BAR_CELLS = 8
// The list says what one of a generator makes, and how far a price is, only
// where the screen is this wide.
const EACH_FROM = 52
const BAR_FROM = 66
const STREAK_CELLS = 5
const SPECIAL_KEYS: Readonly<Record<string, string>> = { space: ' ', return: ' ' }

const hash = (a: number, b: number): number => {
  const mixed = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b | 0, 0x27d4eb2f)
  const scattered = Math.imul(mixed ^ (mixed >>> 15), 0x2c1b3c6d)

  return ((scattered ^ (scattered >>> 13)) >>> 0) / 2 ** 32
}

const untilOf = (props: GameProps, base: number): number =>
  rateOf(props.save) > 0 ? base + props.leftMs / TICK_MS : base

/** The game with the latest props taken in: coins for what was earned since. */
const caughtUp = (game: Game, props: GameProps): Game => {
  if (game.stamp === props.stamp) {
    return game
  }

  const calls = Math.max(0, props.calls - game.calls)
  const mines = Math.max(0, props.mines - game.mines)
  const earned = Array.from({ length: Math.min(calls, MOST_COINS) }, (_, at) => ({
    x: SPARK_X + 1 + Math.floor(hash(props.calls, at) * 4),
    age: -at,
    text: at === 0 ? `+${short(props.gain)}` : '',
  }))
  const mined = Array.from({ length: Math.min(mines, MOST_COINS) }, (_, at) => ({
    x: SPARK_X + 1 + Math.floor(hash(props.mines, at + 7) * 4),
    age: -at,
    text: at === 0 ? `+${short(clickOf(props.save))}` : '',
  }))
  const hasNews = calls + mines > 0

  return {
    ...game,
    base: game.beats,
    stamp: props.stamp,
    until: untilOf(props, game.beats),
    calls: props.calls,
    mines: props.mines,
    coins: [...game.coins, ...earned, ...mined].slice(-MOST_COINS * 2),
    glow: hasNews ? GLOW_BEATS : game.glow,
    calm: hasNews ? 0 : game.calm,
    seq: Math.max(game.seq, props.acked),
    pending: game.pending.filter(press => press.seq > props.acked),
  }
}

const step = (game: Game): Game => ({
  ...game,
  coins: game.coins
    .map(coin => ({ ...coin, age: coin.age + 1 }))
    .filter(coin => coin.age <= COIN_BEATS),
  glow: Math.max(0, game.glow - 1),
  calm: game.calm + 1,
})

/** A key of this screen's, sent to the hooks module with those it has not acted on. */
const press = (surface: ClientSurface<Game>, key: string): void => {
  const game = surface.state

  if (game === undefined) {
    return
  }

  const seq = game.seq + 1
  const pending = [...game.pending, { seq, key }].slice(-MOST_PENDING)
  surface.setState({ ...game, seq, pending })
  surface.post({ keys: pending })
}

const start = (surface: ClientSurface<Game>, props: GameProps): Game => {
  const game: Game = {
    beats: 0,
    base: 0,
    stamp: props.stamp,
    until: untilOf(props, 0),
    calls: props.calls,
    mines: props.mines,
    coins: [],
    glow: 0,
    calm: 0,
    seq: props.acked,
    pending: [],
    hits: [],
  }
  surface.setState(game)
  surface.every(TICK_MS, () => {
    const now = surface.state

    if (now === undefined) {
      return
    }

    // Time passes whether the screen is drawn or not.
    now.beats += 1
    const isMoving = now.coins.length > 0 || now.glow > 0
    const isCounting = now.beats <= now.until
    const isDue = now.calm < CALM_BEATS || now.beats % CALM_EVERY === 0

    if (isMoving || (isCounting && isDue)) {
      surface.setState(step(now))
    }
  })
  surface.onKey(event => {
    const key = SPECIAL_KEYS[event.key] ?? event.key.toLowerCase()

    if (key.length === 1) {
      press(surface, key)
    }
  })
  surface.onPointer(event => {
    const hit =
      event.type === 'down'
        ? surface.state?.hits.find(
            one =>
              one.row === event.y && event.x >= one.x && event.x < one.x + one.wide,
          )
        : undefined

    if (hit !== undefined) {
      press(surface, hit.key)
    }
  })

  return game
}

/** The balance as it is written large: its figures, and the unit after them. */
const figuresOf = (tokens: number, room: number): [string, string] => {
  const whole = tokens >= 1000 && tokens < 1e9 ? grouped(tokens) : ''
  const wide = [...whole].reduce(
    (sum, figure) => sum + (DIGITS[figure]?.[0]?.length ?? 0) + 1,
    0,
  )

  if (whole !== '' && wide <= room) {
    return [whole, '']
  }

  const [, figures = '0', unit = ''] = /^([\d.,]+)(.*)$/.exec(short(tokens)) ?? []

  return [figures, unit]
}

/** The balance in its own digits, with the rate, the rank and the window beside it. */
const hud = ({ props, live, rate, isAsleep }: Frame, canvas: Canvas): void => {
  const right = [
    { text: `+${short(rate)}/s`, color: isAsleep ? RED : GREEN, style: BOLD },
    {
      text:
        live.weights === 0
          ? rankOf(live.ships)
          : `${rankOf(live.ships)} · ${live.weights}w`,
      color: FG,
      style: DIM,
    },
    {
      text: isAsleep
        ? 'window ran out'
        : rate === 0
          ? ''
          : `runs ${span(props.leftMs)} more`,
      color: isAsleep ? RED : FG,
      style: isAsleep ? 0 : DIM,
    },
  ]
  const widest = Math.max(...right.map(line => line.text.length))
  const [figures, unit] = figuresOf(live.tokens, canvas.w - DIGIT_X - widest - EDGE - 2)
  let x = DIGIT_X

  stamp(canvas, 1, 0, GEM, GEM_PALETTE)

  for (const figure of figures) {
    const sprite = DIGITS[figure]

    if (sprite !== undefined) {
      stamp(canvas, x, 0, sprite, { '#': GOLD })
      x += (sprite[0]?.length ?? 0) + 1
    }
  }

  write(canvas, x, Math.floor((DIGIT_HEIGHT - 1) / 2), unit, GOLD, BOLD)
  right.forEach((line, row) => {
    write(canvas, canvas.w - line.text.length - EDGE, row, line.text, line.color, line.style)
  })
}

const paletteOf = (art: Art, beats: number, at: number, isAsleep: boolean): Palette => {
  const isBlinked =
    !isAsleep &&
    art.blink !== undefined &&
    Math.floor((beats + at * 3) / BLINK_BEATS) % 2 === 1
  const lit =
    isBlinked && art.blink !== undefined
      ? { ...art.palette, [art.blink[0]]: art.blink[1] }
      : art.palette

  return isAsleep
    ? Object.fromEntries(
        Object.entries(lit).map(([letter, color]) => [letter, shade(color, ASLEEP_SHADE)]),
      )
    : lit
}

/**
 * The scene over `rows` rows from `top`: the spark at work, one of every
 * generator owned, the sky over them, and the coins on their way up.
 */
const scene = (frame: Frame, canvas: Canvas, top: number, rows: number): void => {
  const { game, live, isAsleep } = frame
  const y0 = top * 2
  const ground = y0 + rows * 2 - 1
  const owned = Object.keys(ART).filter(id => (live.owned[id] ?? 0) > 0)
  const standing = owned.filter(id => ART[id]?.isAloft !== true)
  const aloft = owned.filter(id => ART[id]?.isAloft === true)
  const widths = standing.map(id => (ART[id]?.sprite[0]?.length ?? 0) + SPRITE_GAP)
  const room = canvas.w - FIRST_X - 1
  // The first ones give way when the row is full: the last are the dearest.
  let from = 0
  let wide = widths.reduce((sum, width) => sum + width, 0)

  while (wide > room && from < standing.length) {
    wide -= widths[from] ?? 0
    from += 1
  }

  const sky = Math.max(MIN_SKY, rows * 2 - SKYLINE)

  for (let x = 0; x < canvas.w; x += STAR_EVERY) {
    const at = x + Math.floor(hash(x, 1) * STAR_EVERY)
    const isLit = !isAsleep && hash(at, Math.floor(game.beats / BLINK_BEATS)) < 0.15

    dot(canvas, at, y0 + Math.floor(hash(x, 2) * sky), isLit ? WHITE : SLATE)
  }

  for (let x = 0; x < canvas.w; x += 1) {
    dot(canvas, x, ground, isAsleep ? shade(SLATE, ASLEEP_SHADE) : SLATE)
  }

  aloft.forEach((id, at) => {
    const art = ART[id]

    if (art !== undefined) {
      stamp(
        canvas,
        canvas.w - (at + 1) * ALOFT_EVERY,
        y0 + (at % 2),
        art.sprite,
        paletteOf(art, game.beats, at, isAsleep),
      )
    }
  })

  let x = FIRST_X

  standing.slice(from).forEach((id, at) => {
    const art = ART[id]

    if (art !== undefined) {
      stamp(
        canvas,
        x,
        ground - art.sprite.length,
        art.sprite,
        paletteOf(art, game.beats, at, isAsleep),
      )
      x += (art.sprite[0]?.length ?? 0) + SPRITE_GAP
    }
  })

  stamp(
    canvas,
    SPARK_X,
    ground - SPARK.length,
    game.glow > 0 ? SPARK_LIT : SPARK,
    isAsleep
      ? { o: shade(ORANGE, ASLEEP_SHADE), w: shade(ORANGE, ASLEEP_SHADE) }
      : SPARK_PALETTE,
  )

  if (isAsleep) {
    write(canvas, SPARK_X + SPARK.length + 1, top + rows - 4, 'z Z', FG, DIM)
  }

  if (owned.length === 0 && game.coins.length === 0) {
    write(canvas, FIRST_X, top + rows - 3, "Claude's tool calls pay in here.", FG, DIM)
    write(canvas, FIRST_X, top + rows - 2, '1 buys a Prompt.', FG, DIM)
  }

  for (const coin of game.coins) {
    const y = ground - SPARK.length - 2 - Math.max(0, coin.age)

    if (coin.age >= 0 && y >= y0) {
      stamp(canvas, coin.x, y, COIN, COIN_PALETTE)
      write(canvas, coin.x + 3, Math.floor(y / 2), coin.text, GOLD, BOLD)
    }
  }
}

/** The line under the scene: the latest pay, and the streak. */
const status = ({ props, live }: Frame, canvas: Canvas, row: number): void => {
  const cap = perksOf(live).cap
  const filled = Math.min(
    STREAK_CELLS,
    Math.max(0, Math.round(((props.streak - 1) / (cap - 1)) * STREAK_CELLS)),
  )
  const paid = props.gain > 0 ? `▸ ${props.tool} +${short(props.gain)}` : '▸ no call yet'
  const streak = `streak ×${props.streak.toFixed(1)} `
  const at = canvas.w - streak.length - STREAK_CELLS - EDGE

  write(canvas, 1, row, paid.slice(0, at - 2), props.gain > 0 ? GOLD : FG, props.gain > 0 ? 0 : DIM)
  write(canvas, at, row, streak, FG, props.streak > 1 ? 0 : DIM)
  write(canvas, at + streak.length, row, '▰'.repeat(filled), ORANGE)
  write(canvas, at + streak.length + filled, row, '▱'.repeat(STREAK_CELLS - filled), FG, DIM)
}

/** The balance, the scene and the status line, one over the other. */
const stage = (frame: Frame, canvas: Canvas): void => {
  const rows = canvas.h - HUD_ROWS - 1

  hud(frame, canvas)

  if (rows >= MIN_SCENE_ROWS) {
    scene(frame, canvas, HUD_ROWS, rows)
  }

  status(frame, canvas, canvas.h - 1)

  // A click anywhere on the stage mines by hand.
  for (let row = 0; row < canvas.h; row += 1) {
    frame.hits.push({ x: 0, row, wide: canvas.w, key: ' ' })
  }
}

const tabs = ({ props, live, hits }: Frame, canvas: Canvas, row: number): void => {
  const affordable = openUpgrades(live).filter(upgrade => upgrade.cost <= live.tokens)
  const marks: Readonly<Record<string, string>> = {
    upgrades: affordable.length === 0 ? '' : ` ${affordable.length}`,
    ship: weightsDue(live) === 0 ? '' : ' !',
  }
  let x = 1

  for (const { tab, key, name } of TABS) {
    const label = ` ${name.toUpperCase()}${marks[tab] ?? ''} `
    const isShown = tab === props.view.tab

    write(canvas, x, row, key, GOLD, BOLD)
    write(canvas, x + 2, row, label, isShown ? GOLD : FG, isShown ? INVERSE | BOLD : DIM)
    hits.push({ x, row, wide: label.length + 2, key })
    x += label.length + 3
  }

  if (props.view.tab === 'build') {
    const qty = `${QTY_KEY} ×${props.view.qty}`
    const at = Math.max(x, canvas.w - qty.length - EDGE)

    write(canvas, at, row, QTY_KEY, GOLD, BOLD)
    write(canvas, at + 1, row, qty.slice(1), FG, DIM)
    hits.push({ x: at, row, wide: qty.length, key: QTY_KEY })
  }

  write(canvas, 0, row + 1, '─'.repeat(canvas.w), FG, DIM)
}

const build = (frame: Frame, canvas: Canvas, top: number): void => {
  const { props, live, hits } = frame
  const perks = perksOf(live)
  const all = generatorRows(live)
  const room = canvas.h - top
  const hasEach = canvas.w >= EACH_FROM
  const hasBar = canvas.w >= BAR_FROM
  const costAt = 5 + NAME_WIDE + OWNED_WIDE + 2 + (hasEach ? EACH_WIDE : 0)

  // A list longer than the room keeps its last rows: the dearest ones.
  all.slice(-room).forEach((generator, at) => {
    const row = top + at
    const place = all.indexOf(generator)
    const owned = live.owned[generator.id] ?? 0
    const cost = priceOf(generator, owned, props.view.qty)
    const canBuy = live.tokens >= cost
    const isNew = owned === 0 && !canBuy
    const color = Object.values(ART[generator.id]?.palette ?? {})[0] ?? FG

    write(canvas, 1, row, ROW_KEYS[place] ?? '', GOLD, BOLD)
    write(canvas, 3, row, '■', color, isNew ? DIM : 0)
    write(canvas, 5, row, generator.name, FG, canBuy ? BOLD : isNew ? DIM : 0)
    write(
      canvas,
      5 + NAME_WIDE,
      row,
      `×${owned}`.padStart(OWNED_WIDE),
      FG,
      owned === 0 ? DIM : 0,
    )

    if (hasEach) {
      write(
        canvas,
        7 + NAME_WIDE + OWNED_WIDE,
        row,
        `+${short(yieldOf(generator, perks))}/s`,
        FG,
        DIM,
      )
    }

    write(canvas, costAt, row, `◈${price(cost)}`, canBuy ? GREEN : FG, canBuy ? BOLD : DIM)

    if (hasBar && !canBuy) {
      const share = live.tokens / cost
      const filled = Math.floor(share * BAR_CELLS)

      write(canvas, costAt + COST_WIDE, row, '▰'.repeat(filled), GOLD)
      write(canvas, costAt + COST_WIDE + filled, row, '▱'.repeat(BAR_CELLS - filled), FG, DIM)
      write(
        canvas,
        costAt + COST_WIDE + BAR_CELLS + 1,
        row,
        `${Math.floor(share * 100)}%`,
        FG,
        DIM,
      )
    }

    hits.push({ x: 0, row, wide: canvas.w, key: ROW_KEYS[place] ?? '' })
  })
}

const upgrades = (frame: Frame, canvas: Canvas, top: number): void => {
  const { live, hits } = frame
  const open = openUpgrades(live)
  const listed = upgradeRows(live).slice(0, Math.max(1, canvas.h - top - 1))
  const noteAt = 3 + UPGRADE_WIDE + COST_WIDE
  // The note in full where the row has the room for the longest of them.
  const hasNotes = canvas.w - noteAt > NOTE_WIDE

  if (open.length === 0) {
    write(canvas, 1, top, 'No upgrade is open yet. More open as you own', FG, DIM)
    write(canvas, 1, top + 1, 'more generators and Claude calls more tools.', FG, DIM)

    return
  }

  listed.forEach((upgrade, at) => {
    const row = top + at
    const canBuy = live.tokens >= upgrade.cost

    write(canvas, 1, row, ROW_KEYS[at] ?? '', GOLD, BOLD)
    write(canvas, 3, row, upgrade.name, FG, canBuy ? BOLD : 0)
    write(
      canvas,
      3 + UPGRADE_WIDE,
      row,
      `◈${price(upgrade.cost)}`,
      canBuy ? GREEN : FG,
      canBuy ? BOLD : DIM,
    )
    write(canvas, noteAt, row, hasNotes ? upgrade.note : upgrade.tag, FG, DIM)
    hits.push({ x: 0, row, wide: canvas.w, key: ROW_KEYS[at] ?? '' })
  })

  const row = top + listed.length
  const more = open.length - listed.length
  const all = `buy all the balance covers${more > 0 ? ` · ${more} more, dearer` : ''}`

  write(canvas, 1, row, ALL_KEY, GOLD, BOLD)
  write(canvas, 3, row, all, FG, DIM)
  hits.push({ x: 0, row, wide: canvas.w, key: ALL_KEY })
}

/** The words of a line broken into rows no wider than `wide`. */
const wrapped = (text: string, wide: number): string[] =>
  text.split(' ').reduce<string[]>((rows, word) => {
    const last = rows.at(-1)

    return last !== undefined && last.length + 1 + word.length <= wide
      ? [...rows.slice(0, -1), `${last} ${word}`]
      : [...rows, word]
  }, [])

/** Lines that are read and not pressed, wrapped to the canvas. Answers the row after them. */
const lines = (canvas: Canvas, top: number, said: readonly Line[]): number => {
  const rows = said.flatMap(line =>
    wrapped(line.text, canvas.w - 2).map(text => ({ text, isDim: line.isDim })),
  )

  rows.slice(0, canvas.h - top).forEach((line, at) => {
    write(canvas, 1, top + at, line.text, FG, line.isDim === true ? DIM : 0)
  })

  return top + rows.length
}

const ship = (frame: Frame, canvas: Canvas, top: number): void => {
  const { props, live, hits } = frame
  const row = Math.min(canvas.h - 1, lines(canvas, top, shipLines(live)) + 1)

  if (weightsDue(live) > 0) {
    const label = ` ${shipLabel(live, props.view)} `

    write(canvas, 1, row, SHIP_KEY, GOLD, BOLD)
    write(canvas, 3, row, label, props.view.isArmed ? RED : GOLD, INVERSE | BOLD)
    hits.push({ x: 0, row, wide: canvas.w, key: SHIP_KEY })
  }
}

/** The tabs, and under them what the tab in view lists. */
const shop = (frame: Frame, canvas: Canvas): void => {
  const top = 2
  const shown: Readonly<Record<TycoonView['tab'], () => void>> = {
    build: () => build(frame, canvas, top),
    upgrades: () => upgrades(frame, canvas, top),
    records: () => void lines(canvas, top, recordLines(frame.live)),
    ship: () => ship(frame, canvas, top),
  }

  tabs(frame, canvas, 0)
  shown[frame.props.view.tab]()
}

/** One part of the screen painted on a canvas of its own, then set in its place. */
const placed = (
  frame: Frame,
  screen: Canvas,
  part: (frame: Frame, canvas: Canvas) => void,
  at: { x: number; row: number; w: number; h: number },
): Hit[] => {
  const canvas = canvasOf(at.w, at.h)
  const own: Frame = { ...frame, hits: [] }

  part(own, canvas)
  blit(screen, canvas, at.x, at.row)

  return own.hits.map(hit => ({ ...hit, x: hit.x + at.x, row: hit.row + at.row }))
}

/**
 * Paints the whole screen and answers where a click means a key. A wide
 * screen sets the stage beside the shop; a narrow one, over it.
 */
const paint = (screen: Canvas, game: Game, props: GameProps): Hit[] => {
  const rate = rateOf(props.save)
  const ranMs = Math.min((game.beats - game.base) * TICK_MS, props.leftMs)
  const frame: Frame = {
    game,
    props,
    live: { ...props.save, tokens: props.save.tokens + (rate * ranMs) / 1000 },
    rate,
    isAsleep: rate > 0 && ranMs >= props.leftMs,
    hits: [],
  }

  if (screen.w >= WIDE_FROM) {
    const left = Math.min(STAGE_WIDE, Math.floor(screen.w * 0.42))

    for (let row = 0; row < screen.h; row += 1) {
      write(screen, left + 1, row, '│', FG, DIM)
    }

    return [
      ...placed(frame, screen, shop, {
        x: left + 3,
        row: 0,
        w: screen.w - left - 3,
        h: screen.h,
      }),
      ...placed(frame, screen, stage, { x: 0, row: 0, w: left, h: screen.h }),
    ]
  }

  // Stacked, the stage takes what the list can spare, up to its own best.
  const high = Math.min(
    HUD_ROWS + STAGE_SCENE_ROWS + 1,
    Math.max(HUD_ROWS + 1, screen.h - SHOP_ROWS),
  )

  return [
    ...placed(frame, screen, shop, {
      x: 0,
      row: high + 1,
      w: screen.w,
      h: screen.h - high - 1,
    }),
    ...placed(frame, screen, stage, { x: 0, row: 0, w: screen.w, h: high }),
  ]
}

const Tycoon: ClientModule<GameProps, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  const known = surface.state ?? start(surface, props)
  const game = caughtUp(known, props)

  if (game !== known) {
    surface.setState(game)
  }

  const columns = Math.min(surface.columns, MAX_COLUMNS)

  if (columns < MIN_COLUMNS || surface.rows < MIN_ROWS) {
    return <Text dimColor>Tycoon needs a little more room.</Text>
  }

  const canvas = canvasOf(columns, surface.rows)
  // The state is the game's own to change: where a click lands is no drawing.
  game.hits = paint(canvas, game, props)

  return (
    <Box flexDirection="column">
      {rowsOf(canvas).map(runs => (
        <Box>
          {runs.map(({ text, ...style }) => (
            <Text {...style} wrap="truncate-end">
              {text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Tycoon
