import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

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

/** The engine beneath the game: a store, a clock, and the toasts it was sent. */
const world = (on: On, save?: Record<string, unknown>) => {
  const toasts: string[] = []
  mock.store(on, save === undefined ? {} : { save: { ...EMPTY, ...save } })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return { toasts, clock: mock.clock(on, { now: START }) }
}

const stats = async ($: Engine): Promise<string> =>
  (await $.command.run(STATS)).text ?? ''

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
  world(on, { tokens: 1000 })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SCREEN)
  await ui.key({ key: '1' })
  expect(await stats($)).toContain('1 generator bought')

  // The first row of the list: under the ten rows of the stage, a clear row,
  // the tabs and their rule.
  await ui.pointer({ type: 'down', x: 8, y: 13, button: 'left' })
  expect(await stats($)).toContain('2 generators bought')

  await ui.key({ key: 'x' })
  await ui.key({ key: '2' })
  expect(await stats($)).toContain('2 generators bought')
  expect(await ui.find({ in: 'game', text: '×10' })).toBeDefined()
  await ui.unmount()
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

test('a ship takes two presses, gives the run up and keeps the weights', async ($, on) => {
  const { toasts } = world(on, {
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

  await ui.key({ key: 'y' })
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

  expect((await $.command.run({ ...STATS, args: 'stop' })).text).toContain(
    'Tycoon is closed',
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

test('the balance follows the hint line under the prompt once something is earned', async ($, on) => {
  world(on, { tokens: 1500, lifeEarned: 1500, owned: { script: 10 } })
  on('ui.render', { component: 'PromptHint' }, ($$, e) =>
    $$.ui.resolve(e).Text({ children: `${e.props.hint}${e.props.tail ?? ''}` }),
  )
  const HINT = {
    plugin: 'tycoon',
    component: 'PromptHint',
    surface: 'terminal',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    viewport: { columns: 80, rows: 40 },
  } as const

  const bare = await $.ui.mount(HINT)
  expect(await bare.find({ type: 'Text', text: '◈' })).toBeUndefined()
  await bare.unmount()

  // The session's copy of the save is read once something settles it, which
  // is also when the two feats the save has earned add their 4%.
  await stats($)
  const ui = await $.ui.mount(HINT)
  expect(
    await ui.find({ type: 'Text', text: '? for shortcuts  ◈ 1.50K +6.2/s' }),
  ).toBeDefined()
  await ui.unmount()

  await $.command.run({ ...STATS, args: 'hint off' })
  const off = await $.ui.mount(HINT)
  expect(await off.find({ type: 'Text', text: '◈' })).toBeUndefined()
  await off.unmount()
})
