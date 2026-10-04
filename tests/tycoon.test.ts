import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { flawOf } from '../hooks/sim'
import type { TycoonSave } from '../types'

const PANE = {
  plugin: 'tycoon',
  component: 'Pane',
  requestId: 'tycoon',
  props: {
    title: 'Token Tycoon',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 18 },
    view: {},
  },
  viewport: { columns: 80, rows: 40 },
} as const
const SCREEN = { columns: 80, rows: 22, in: 'game' }
// The hint line under the prompt, in the fullscreen layout a click reaches.
const HINT = {
  plugin: 'tycoon',
  component: 'PromptHint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  viewport: { columns: 80, rows: 40, isFullscreen: true },
} as const
// `/tycoon stats` as the person types it at the prompt.
const STATS = {
  command: 'tycoon',
  args: 'stats',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
} as const
const HOUR = 3_600_000
// When every test's clock starts, and when its save was last settled.
const START = 1_700_000_000_000
const EMPTY = {
  v: 1,
  tokens: 0,
  at: START,
  runEarned: 0,
  lifeEarned: 0,
  owned: {},
  upgrades: [],
  feats: [],
  weights: 0,
  ships: 0,
  calls: {},
  stats: { calls: 0, fails: 0, clicks: 0, turns: 0, burned: 0, bought: 0 },
}

// Somebody who has joined the global top, as the store keeps them.
const ADA = {
  id: '00000000-0000-4000-8000-000000000001',
  key: '00000000-0000-4000-8000-000000000002',
  name: 'Ada',
  best: 10,
  rank: 5,
}
// A page of the board as the server sends it.
const TOP = {
  top: [
    { name: 'Rex', score: 4.2e15, ships: 10 },
    { name: 'Ada', score: 1234, ships: 0 },
  ],
  page: 1,
  pages: 3,
  players: 25,
  you: null,
}

/**
 * The engine beneath the game: a store, a clock, and the toasts it was sent.
 * The store is handed back: a test stands in for another session through it.
 */
const world = (
  on: On,
  save?: Record<string, unknown>,
  player?: Record<string, unknown>,
) => {
  const toasts: string[] = []
  const store = new Map<string, unknown>([
    ...(save === undefined ? [] : [['save', { ...EMPTY, ...save }] as const]),
    ...(player === undefined ? [] : [['player', player] as const]),
  ])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return { toasts, store, clock: mock.clock(on, { now: START }) }
}

const stats = async ($: Engine): Promise<string> =>
  (await $.command.run(STATS)).text ?? ''

/** `/tycoon <args>` as the person types it, and what it answers. */
const told = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run({ ...STATS, args })).text ?? ''

type Asked = { path: string; query: string; body: Record<string, unknown> }

/**
 * The leaderboard's server, answered from memory: each path's status and
 * body, a 404 for any other. Answers the list of what was asked of it.
 */
const board = (
  on: On,
  replies: Readonly<Record<string, readonly [number, unknown]>>,
): Asked[] => {
  const asked: Asked[] = []

  on('http.fetch', (_$, e) => {
    const { pathname, search } = new URL(e.url)
    const [status, body] = replies[pathname] ?? [404, { error: 'not-found' }]
    asked.push({ path: pathname, query: search, body: JSON.parse(e.init?.body ?? '{}') })

    return {
      value: {
        status,
        ok: status === 200,
        headers: {},
        text: JSON.stringify(body),
      },
    }
  })

  return asked
}

test("a tool call pays its family's wage, and the next call builds a streak", async ($, on) => {
  const { toasts } = world(on)
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(await stats($)).toContain('Tycoon: ◈2 ·')
  expect(await stats($)).toContain('1 call,')
  expect(toasts.join()).toContain('Hello, world')

  // An edit pays 3, the first feat adds 2% and the streak stands at ×1.1.
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  expect(await stats($)).toContain('Tycoon: ◈5.3 ·')
})

test('a streak holds through a short pause and ends after a minute of silence', async ($, on) => {
  const { clock } = world(on)
  on('tool.call', () => ({ result: {} }))
  const bash = () => $.tool.call({ tool: 'Bash', command: 'ls' })

  await bash()
  await bash()
  // 2, then 2 at ×1.1 with the first feat's 2%.
  expect(await stats($)).toContain('Tycoon: ◈4.2 ·')

  // Thirty seconds on the streak neither builds nor ends: ×1.1 again.
  await clock.advance(30_000)
  await bash()
  expect(await stats($)).toContain('Tycoon: ◈6.4 ·')

  // Past a minute it begins again at ×1.
  await clock.advance(61_000)
  await bash()
  expect(await stats($)).toContain('Tycoon: ◈8.5 ·')
})

// Each kind of upgrade, by what it changes in what is paid.
const BASH = { tool: 'Bash', command: 'ls' } as const
const READ = { tool: 'Read', file_path: '/a' } as const
const SIXTEEN_READS = Array.from({ length: 16 }, () => READ)

for (const { name, save, calls, told } of [
  {
    name: 'a wage upgrade pays its family a quarter more',
    save: { upgrades: ['bash-wage-1'] },
    calls: [BASH],
    told: 'Tycoon: ◈2.5 ·',
  },
  {
    // Ten scripts make 6 a second: a tenth of a second of that on a read's 1.
    name: 'Throughput adds seconds of what the generators make to every call',
    save: { upgrades: ['seconds-1'], owned: { script: 10 } },
    calls: [READ],
    told: 'Tycoon: ◈1.6 ·',
  },
  {
    // The eleventh call reaches ×2, and the five after it stay there.
    name: 'a streak builds no further than ×2',
    save: {},
    calls: SIXTEEN_READS,
    told: 'Tycoon: ◈27 ·',
  },
  {
    name: "Flow State lifts the streak's cap",
    save: { upgrades: ['combo-1'] },
    calls: SIXTEEN_READS,
    told: 'Tycoon: ◈28.5 ·',
  },
  {
    // Two hours of the ten are paid, where one was.
    name: 'Context Window lengthens what the generators run unattended',
    save: { upgrades: ['window-1'], owned: { script: 10 }, at: START - 10 * HOUR },
    calls: [],
    told: 'Tycoon: ◈43.2K ·',
  },
]) {
  test(name, async ($, on) => {
    world(on, save)
    on('tool.call', () => ({ result: {} }))

    for (const call of calls) {
      await $.tool.call(call)
    }

    expect(await stats($)).toContain(told)
  })
}

test('a call that failed pays half, and one that was refused pays nothing', async ($, on) => {
  world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {}, isError: true }))
  on('tool.call', { tool: 'Read' }, () => ({ deny: 'not here' }))

  await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(await stats($)).toContain('Tycoon: ◈1 ·')
  expect(await stats($)).toContain('1 call, 1 failed')

  await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(await stats($)).toContain('1 call, 1 failed')
})

test('calls that come in parallel are all paid', async ($, on) => {
  world(on)
  on('tool.call', () => ({ result: {} }))

  await Promise.all(
    Array.from({ length: 25 }, () => $.tool.call({ tool: 'Read', file_path: '/a' })),
  )
  expect(await stats($)).toContain('25 calls')
})

test('the end of a turn pays by the output tokens it cost', async ($, on) => {
  world(on)
  on('turn.complete', () => ({ text: '' }))
  const turn = {
    answer: 'done',
    durationMs: 10,
    turnId: 't1',
    usage: {
      model: 'claude',
      input_tokens: 10,
      output_tokens: 4000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }

  await $.turn.complete({ ...turn, isAborted: false, reason: 'answer' })
  // Ten calls' worth of the payroll wage, 2.
  expect(await stats($)).toContain('Tycoon: ◈20 ·')

  await $.turn.complete({ ...turn, isAborted: true, reason: 'aborted' })
  expect(await stats($)).toContain('Tycoon: ◈20 ·')
})

test('a generator is bought with its key and makes tokens while the clock runs', async ($, on) => {
  const { clock } = world(on, { tokens: 100 })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SCREEN)
    expect(await ui.find({ in: 'game', text: 'Prompt' })).toBeDefined()
    expect(await ui.find({ in: 'game', text: '×0' })).toBeDefined()

    // The keys field is the keyboard: the key typed last is the press.
    await ui.input({ key: 'keys', text: '1', kind: 'change' })
    await ui.unmount()
  }

  // Two prompts cost 15 and 17.25; the first one earned a feat's 2%.
  expect(await stats($)).toContain('Tycoon: ◈67.7 ·')
  expect(await stats($)).toContain('2 generators bought')

  await clock.advance(100_000)
  // Two prompts at 0.1 a second, 2% more: 20.4 in a hundred seconds.
  expect(await stats($)).toContain('Tycoon: ◈88.1 ·')
})

test('a key or a click on the screen itself is the same press', async ($, on) => {
  const { clock } = world(on, { tokens: 1000 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.key({ key: '1' })
  expect(await stats($)).toContain('1 generator bought')

  // The first row of the list: under the eleven rows of the stage, a clear
  // row, the tabs and their rule.
  await ui.pointer({ type: 'down', x: 8, y: 14, button: 'left' })
  expect(await stats($)).toContain('2 generators bought')

  // Ten at a time: ten scripts are out of reach, ten prompts are not. The
  // scene shows a buy against the moment before it, so each has its own.
  await clock.advance(1000)
  await ui.key({ key: 'x' })
  await ui.key({ key: '2' })
  expect(await stats($)).toContain('2 generators bought')
  expect(await ui.find({ in: 'game', text: '×10' })).toBeDefined()

  await clock.advance(1000)
  await ui.key({ key: '1' })
  expect(await stats($)).toContain('12 generators bought')

  // What was bought rises over its generator, and is gone.
  expect(await ui.find({ in: 'game', text: '+10' })).toBeDefined()
  await ui.advance(2000)
  expect(await ui.find({ in: 'game', text: '+10' })).toBeUndefined()
  await ui.unmount()
})

test('a wide screen sets the shop beside the stage, and a click still lands on its row', async ($, on) => {
  const { clock } = world(on, { tokens: 1000 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 120, rows: 14, in: 'game' })

  // The stage takes the left 50 columns: a click on it mines by hand.
  await ui.pointer({ type: 'down', x: 20, y: 6, button: 'left' })
  await clock.advance(250)
  // The list's first row is the third of the shop, right of the stage.
  await ui.pointer({ type: 'down', x: 60, y: 2, button: 'left' })
  await ui.unmount()

  const told = await stats($)
  expect(told).toContain('1 generator bought')
  expect(told).toContain('Tycoon: ◈986 ·')
})

test('space mines by hand, and the clicks of a moment are paid together', async ($, on) => {
  const { clock } = world(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.input({ key: 'keys', text: ' ', kind: 'change' })
  await ui.input({ key: 'keys', text: '  ', kind: 'change' })
  await ui.input({ key: 'keys', text: '' })
  await clock.advance(250)
  await ui.unmount()

  expect(await stats($)).toContain('Tycoon: ◈3 ·')
})

test('a buy the balance does not cover changes nothing and says so', async ($, on) => {
  const { toasts } = world(on, { tokens: 10 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.key({ key: '1' })
  await ui.unmount()

  expect(await stats($)).toContain('Tycoon: ◈10 ·')
  expect(toasts.join()).toContain('not enough tokens')
})

test('the generators stop when the context window runs out', async ($, on) => {
  // Ten scripts make 6 a second; the save was last settled ten hours ago.
  world(on, { owned: { script: 10 }, at: START - 10 * HOUR })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  expect(await ui.find({ in: 'game', text: 'window ran out' })).toBeDefined()
  await ui.unmount()

  // One hour of the ten is paid: the feat it earns adds its 2% only after.
  expect(await stats($)).toContain('Tycoon: ◈21.6K ·')
})

test('an upgrade is bought on its tab, kept in the save, and doubles its generator', async ($, on) => {
  world(on, { tokens: 1000, owned: { prompt: 1 }, feats: ['first-prompt'] })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  expect(await ui.find({ in: 'game', text: 'Prompt I' })).toBeUndefined()

  await ui.key({ key: 'u' })
  expect(await ui.find({ in: 'game', text: 'Prompt I' })).toBeDefined()

  await ui.key({ key: '1' })
  expect(await ui.find({ in: 'game', text: 'Prompt I' })).toBeUndefined()
  await ui.unmount()

  expect(await stats($)).toContain('1 upgrade ·')
  expect(await stats($)).toContain('+0.2/s')
})

test('b buys every upgrade the balance covers, the cheapest first', async ($, on) => {
  // Open: Prompt I at 150, Context Window I at 1,000 and Script I at 1,500.
  world(on, { tokens: 2000, owned: { prompt: 1, script: 1 } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.key({ key: 'u' })
  await ui.key({ key: 'b' })
  await ui.unmount()

  const told = await stats($)
  expect(told).toContain('Tycoon: ◈850 ·')
  expect(told).toContain('2 upgrades ·')
})

test('a ship takes two presses, gives the run up and keeps the weights', async ($, on) => {
  const { toasts, clock } = world(on, {
    tokens: 5,
    lifeEarned: 8e9,
    owned: { prompt: 3 },
    upgrades: ['prompt-1'],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.key({ key: 'p' })
  await ui.key({ key: 'y' })
  expect(await stats($)).toContain('0 weights')
  expect(await ui.find({ in: 'game', text: 'again: give this run up' })).toBeDefined()

  await clock.advance(1000)
  await ui.key({ key: 'y' })
  expect(await ui.find({ in: 'game', text: 'Sonnet shipped' })).toBeDefined()
  await ui.unmount()

  const told = await stats($)
  expect(told).toContain('Tycoon: ◈0 · +0/s')
  expect(told).toContain('Sonnet, 2 weights (+10%)')
  expect(told).toContain('0 upgrades ·')
  expect(toasts.join()).toContain('Sonnet shipped')
})

test('a save from an older or a broken file reads as far as it makes sense', async ($, on) => {
  world(on, {
    tokens: 'many',
    owned: { prompt: 2.9, warp: 5 },
    upgrades: ['prompt-1', 'prompt-1', 'gone'],
    stats: null,
  })

  const told = await stats($)
  expect(told).toContain('Tycoon: ◈0 ·')
  expect(told).toContain('1 upgrade ·')
})

test('/tycoon hint and /tycoon reset take their words, and say what they take', async ($, on) => {
  world(on, { tokens: 50 })

  const run = (args: string) => $.command.run({ ...STATS, args })

  expect((await run('hint off')).text).toBe('The balance is off the hint line.')
  expect((await run('hint')).text).toContain('The balance shows')
  expect((await run('hint maybe')).text).toContain('Usage: /tycoon')
  expect((await run('dance')).text).toContain('Usage: /tycoon')
  expect((await run('reset')).text).toContain('/tycoon reset confirm')
  expect(await stats($)).toContain('Tycoon: ◈50 ·')

  expect((await run('reset confirm')).text).toContain('Tycoon is reset')
  expect(await stats($)).toContain('Tycoon: ◈0 ·')
})

test('/tycoon stop closes the pane that /tycoon opened', async ($, on) => {
  world(on)

  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })

  expect((await $.command.run({ ...STATS, args: 'play' })).text).toContain(
    'Tycoon is open',
  )
  expect(opened).toEqual(['tycoon'])

  expect((await $.command.run({ ...STATS, args: 'stop' })).text).toBe(
    'The pane is closed, and Tycoon still earns. /tycoon opens it again, and /tycoon close takes the balance off the hint line too.',
  )
  expect(closed).toEqual(['tycoon'])
})

test('the surfaces that draw no screen get the game as buttons', async ($, on) => {
  world(on, { tokens: 100 })

  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '◈ ' })).toBeDefined()

    await ui.press({ key: 'gen-prompt' })
    expect((await ui.find({ key: 'gen-prompt' }))?.text).toContain('×')
    await ui.press({ key: 'tab-records' })
    expect(await ui.find({ type: 'Text', text: 'Achievements' })).toBeDefined()
    await ui.press({ key: 'tab-build' })
    await ui.unmount()
  }

  expect(await stats($)).toContain('2 generators bought')
})

test('a session that starts after time away says what the generators made', async ($, on) => {
  const { toasts } = world(on, { owned: { script: 10 }, at: START - 10 * HOUR })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts.join()).toContain('made ◈21.6K while away')
})

test('the balance shows on the hint line once something is earned, and a click on it opens and closes the pane', async ($, on) => {
  world(on, { tokens: 1500, lifeEarned: 1500, owned: { script: 10 } }, ADA)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // The engine's own hint line: its text, and a tail where a mod added one.
  on('ui.render', { component: 'PromptHint' }, ($$, e) =>
    $$.ui.resolve(e).Text({ children: `${e.props.hint}${e.props.tail ?? ''}` }),
  )
  const moved: string[] = []
  on('ui.open', (_$, e) => {
    moved.push(`open ${e.id}`)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    moved.push(`close ${e.id}`)

    return { value: undefined }
  })
  // The balance and the rate, two upgrades the balance covers, fifth on the board.
  const LABEL = '◈ 1.50K +6.2/s · ↑2 · #5'

  const bare = await $.ui.mount(HINT)
  expect(await bare.find({ key: 'toggle' })).toBeUndefined()
  await bare.unmount()

  // The session reads the save and who the person is on the global top as it
  // starts, which is also when the two feats the save has earned add their 4%.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(HINT)
  expect((await ui.find({ key: 'toggle' }))?.text).toBe(LABEL)
  // The line itself stays as the engine drew it.
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(moved).toEqual(['open tycoon'])
  await ui.press({ key: 'toggle' })
  expect(moved).toEqual(['open tycoon', 'close tycoon'])
  await ui.unmount()

  // The main screen has no pointer to click with: the balance is the line's tail.
  const plain = await $.ui.mount({
    ...HINT,
    viewport: { columns: 80, rows: 40, isFullscreen: false },
  })
  expect(await plain.find({ key: 'toggle' })).toBeUndefined()
  expect(
    await plain.find({ type: 'Text', text: `? for shortcuts  ${LABEL}` }),
  ).toBeDefined()
  await plain.unmount()

  await told($, 'hint off')
  const off = await $.ui.mount(HINT)
  expect(await off.find({ key: 'toggle' })).toBeUndefined()
  expect(await off.find({ type: 'Text', text: '◈' })).toBeUndefined()
  await off.unmount()
})

/**
 * A session as it starts, under the engine's own hint line: answers the
 * panes it was asked to open and close, in order.
 */
const started = async ($: Engine, on: On): Promise<string[]> => {
  const moved: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'PromptHint' }, ($$, e) =>
    $$.ui.resolve(e).Text({ children: `${e.props.hint}${e.props.tail ?? ''}` }),
  )
  on('ui.open', (_$, e) => {
    moved.push(`open ${e.id}`)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    moved.push(`close ${e.id}`)

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  return moved
}

/** Whether the balance shows on the hint line: a button in the fullscreen layout, the line's tail on the main screen. */
const hinted = async ($: Engine): Promise<{ isButton: boolean; isTail: boolean }> => {
  const full = await $.ui.mount(HINT)
  const isButton = (await full.find({ key: 'toggle' })) !== undefined
  await full.unmount()
  const plain = await $.ui.mount({
    ...HINT,
    viewport: { ...HINT.viewport, isFullscreen: false },
  })
  const isTail = (await plain.find({ type: 'Text', text: '◈' })) !== undefined
  await plain.unmount()

  return { isButton, isTail }
}

test('/tycoon close takes the pane, the balance and the toasts away, and /tycoon brings them back as they were', async ($, on) => {
  const { toasts } = world(on, { tokens: 1500, lifeEarned: 1500, owned: { script: 10 } })
  on('tool.call', () => ({ result: {} }))
  const moved = await started($, on)
  await told($, 'play')
  expect(await hinted($)).toEqual({ isButton: true, isTail: true })

  expect(await told($, 'close')).toBe(
    'Tycoon is closed: the pane, the balance on the hint line and its toasts are away, and it still earns. /tycoon brings them back.',
  )
  expect(moved).toEqual(['open tycoon', 'close tycoon'])
  expect(await hinted($)).toEqual({ isButton: false, isTail: false })

  // The game goes on earning, and keeps what it earns to itself: the first
  // call's achievement is no toast.
  toasts.length = 0
  await $.tool.call(BASH)
  expect(await stats($)).toContain('1 call,')
  expect(await stats($)).toContain('3 achievements')
  expect(toasts).toEqual([])

  expect(await told($, '')).toContain('Tycoon is open')
  expect(moved.at(-1)).toBe('open tycoon')
  expect(await hinted($)).toEqual({ isButton: true, isTail: true })

  // A balance the person took off the hint line stays off when it comes back.
  await told($, 'hint off')
  expect(await told($, 'quit')).toContain('Tycoon is closed')
  await told($, 'play')
  expect(await hinted($)).toEqual({ isButton: false, isTail: false })

  // Closed, /tycoon hint brings the balance back on its own.
  await told($, 'hint on')
  expect(await told($, 'exit')).toContain('Tycoon is closed')
  await told($, 'hint')
  expect(await hinted($)).toEqual({ isButton: true, isTail: true })
  expect(await told($, 'close now')).toContain('Usage: /tycoon')
})

test('/tycoon close, /tycoon and /tycoon hint in another session reach this one at its next look', async ($, on) => {
  const { toasts, store, clock } = world(on, {
    tokens: 1500,
    lifeEarned: 1500,
    owned: { script: 10 },
  })
  on('tool.call', () => ({ result: {} }))
  const moved = await started($, on)
  // Another session writes to the store this one reads.
  const elsewhere = (change: object) =>
    store.set('settings', { ...Object(store.get('settings')), ...change })
  await told($, 'play')

  elsewhere({ isClosed: true })
  expect(await hinted($)).toEqual({ isButton: true, isTail: true })
  await clock.advance(2000)
  expect(await hinted($)).toEqual({ isButton: false, isTail: false })
  expect(moved).toEqual(['open tycoon', 'close tycoon'])
  toasts.length = 0
  await $.tool.call(BASH)
  expect(toasts).toEqual([])

  // The balance comes back; the pane is this session's own to open.
  elsewhere({ isClosed: false })
  await clock.advance(2000)
  expect(await hinted($)).toEqual({ isButton: true, isTail: true })
  expect(moved).toEqual(['open tycoon', 'close tycoon'])

  elsewhere({ hasHint: false })
  await clock.advance(2000)
  expect(await hinted($)).toEqual({ isButton: false, isTail: false })
})

test('/tycoon top lists a page of the board, /tycoon name joins it with the save and /tycoon leave leaves it', async ($, on) => {
  world(on, { tokens: 50, runEarned: 50, lifeEarned: 50 })
  const asked = board(on, {
    '/top': [200, TOP],
    '/players': [200, { name: 'Ada', best: 0, rank: null }],
    '/saves': [200, { score: 50, best: 50, rank: 2, held: false }],
    '/leave': [200, { left: 'Ada' }],
  })

  const top = await told($, 'top')
  expect(top).toContain('Tycoon global top · 25 players · page 1 of 3')
  expect(top).toContain('  1  ◈4.20Qa   Mythos  Rex')
  expect(top).toContain('  2  ◈1.23K    Haiku   Ada')

  await told($, 'top 3')
  expect(asked.at(-1)?.query).toContain('page=3')
  expect(await told($, 'top 11')).toContain('Usage: /tycoon')

  expect(await told($, 'name')).toContain('not on the global top')
  const joined = await told($, 'name Ada')
  expect(joined).toContain('on the global top as Ada')
  expect(joined).toContain('#2 on the global top with ◈50')
  // The name goes up as typed, and the save after it with nothing of the session.
  expect(asked.at(-2)?.body.name).toBe('Ada')
  expect(asked.at(-1)?.path).toBe('/saves')
  expect(asked.at(-1)?.body.save).toMatchObject({
    lifeEarned: 50,
    at: 0,
    stats: { burned: 0 },
  })
  expect(await told($, 'name')).toContain('as Ada, with ◈50')

  expect(await told($, 'leave')).toContain('off the global top')
  expect(asked.at(-1)?.path).toBe('/leave')
  expect(await told($, 'name')).toContain('not on the global top')
})

test('a refusal or a silent leaderboard is told, and joins nothing', async ($, on) => {
  world(on)
  board(on, { '/players': [409, { error: 'name-taken' }] })

  expect(await told($, 'name Rex')).toBe('That name is taken. Try another.')
  expect(await told($, 'name')).toContain('not on the global top')
  // No route answers for the board itself here: the server's 404 is no board.
  expect(await told($, 'top')).toContain('did not answer')
})

test('t shows the global top in the pane, fetched only when asked for, and a key turns its page', async ($, on) => {
  const { clock } = world(on, { tokens: 100 }, ADA)
  const asked = board(on, { '/top': [200, TOP] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SCREEN)
    const before = asked.length

    // The board is asked for behind the press: the tab shows at once.
    await ui.key({ key: 't' })
    await clock.settle()
    expect(asked.length).toBe(before + 1)
    expect(asked.at(-1)?.query).toContain('page=1')
    expect(await ui.find({ in: 'game', text: 'Mythos  Rex' })).toBeDefined()
    // Their own row is marked, and the line under the page says where they stand.
    expect(await ui.find({ in: 'game', text: '▸  2' })).toBeDefined()
    expect(await ui.find({ in: 'game', text: '25 players · you are #5' })).toBeDefined()

    // On this tab a row's key is a page of the board, and buys nothing.
    await ui.key({ key: '2' })
    await clock.settle()
    expect(asked.at(-1)?.query).toContain('page=2')
    await ui.key({ key: 'g' })
    await ui.unmount()
  }

  expect(await stats($)).toContain('0 generators bought')
})

test('the top tab asks somebody who is not on the board for a name, and enter joins with it', async ($, on) => {
  const { toasts } = world(on, { tokens: 50, runEarned: 50, lifeEarned: 50 })
  const asked = board(on, {
    '/top': [200, TOP],
    '/players': [200, { name: 'Ada', best: 0, rank: null }],
    '/saves': [200, { score: 50, best: 50, rank: 2, held: false }],
  })
  const ASKING = { type: 'Text', text: 'enter joins the global top' } as const

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  expect(await ui.find(ASKING)).toBeUndefined()
  await ui.key({ key: 't' })
  expect(await ui.find(ASKING)).toBeDefined()

  // The field takes the name: a letter that is a tab's key changes no tab.
  await ui.input({ key: 'keys', text: 'g', kind: 'change' })
  expect(await ui.find(ASKING)).toBeDefined()

  // Enter alone puts the question away, and n asks it again.
  await ui.input({ key: 'keys', text: '' })
  expect(await ui.find(ASKING)).toBeUndefined()
  await ui.key({ key: 'n' })
  expect(await ui.find(ASKING)).toBeDefined()

  await ui.input({ key: 'keys', text: 'Ada' })
  expect(asked.some(one => one.path === '/players' && one.body.name === 'Ada')).toBe(true)
  expect(asked.some(one => one.path === '/saves')).toBe(true)
  expect(toasts.join()).toContain('on the global top as Ada')
  expect(await ui.find(ASKING)).toBeUndefined()
  await ui.unmount()

  expect(await told($, 'name')).toContain('as Ada')
})

test('/tycoon name off stops the top tab asking for a name', async ($, on) => {
  world(on)
  board(on, { '/top': [200, TOP] })

  expect(await told($, 'name off')).toContain('will not ask for a name again')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.key({ key: 't' })
  expect(await ui.find({ type: 'Text', text: 'enter joins the global top' })).toBeUndefined()
  await ui.unmount()
})

test('the end of a turn sends the save of somebody on the board, ten minutes apart at the least', async ($, on) => {
  const { toasts, clock } = world(on, { tokens: 100, runEarned: 100, lifeEarned: 100 }, ADA)
  const asked = board(on, {
    '/saves': [200, { score: 120, best: 120, rank: 3, held: false }],
  })
  on('turn.complete', () => ({ text: '' }))
  // The save goes up behind the turn's end, which waits on no server.
  const turn = async () => {
    await $.turn.complete({
      answer: 'done',
      durationMs: 10,
      turnId: 't1',
      isAborted: false,
      reason: 'answer',
      usage: {
        model: 'claude',
        input_tokens: 10,
        output_tokens: 4000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })
    await clock.settle()
  }

  await turn()
  expect(asked.map(one => one.path)).toEqual(['/saves'])
  expect(asked[0]?.body).toMatchObject({ id: ADA.id, key: ADA.key, rules: 1 })
  // From fifth to third: a toast says where the save put them.
  expect(toasts.join()).toContain('#3 on the global top')

  await turn()
  expect(asked.length).toBe(1)

  await clock.advance(10 * 60_000)
  await turn()
  expect(asked.length).toBe(2)
})

// What the leaderboard's server asks of a save: each row is one that does
// not add up, by what it changes of a save that does.
const SOUND: TycoonSave = {
  ...EMPTY,
  v: 1,
  tokens: 40,
  runEarned: 2000,
  lifeEarned: 2000,
  owned: { prompt: 3 },
  upgrades: ['prompt-1'],
  feats: ['first-prompt', 'earned-1000'],
  calls: { bash: 5, turn: 2 },
  stats: { calls: 5, fails: 1, clicks: 0, turns: 2, burned: 0, bought: 3 },
}

test('a save that was played by the rules adds up', () => {
  expect(flawOf(SOUND)).toBeUndefined()
})

const FLAWED: readonly (readonly [string, Partial<TycoonSave>])[] = [
  ['spent', { tokens: 1900 }],
  ['earned', { lifeEarned: 1500 }],
  ['weights', { weights: 1, ships: 1 }],
  ['upgrades', { upgrades: ['prompt-2'] }],
  ['upgrades', { upgrades: ['prompt-1', 'bash-wage-1'] }],
  ['feats', { feats: ['calls-100'] }],
  ['counts', { calls: { bash: 9, turn: 2 } }],
  ['counts', { owned: { prompt: 4 } }],
]

for (const [flaw, change] of FLAWED) {
  test(`a save does not add up: ${flaw}, with ${JSON.stringify(change)}`, () => {
    expect(flawOf({ ...SOUND, ...change })).toBe(flaw)
  })
}

