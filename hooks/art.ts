// The game's pixels: one sprite for each generator, the spark that stands
// for Claude at work, the coin, and the digits the balance is written in.
// A sprite is rows of letters, each letter a color of its palette.

export type Sprite = readonly string[]
export type Palette = Readonly<Record<string, string>>
export type Art = {
  sprite: Sprite
  palette: Palette
  // The letter that blinks, and the color it blinks to.
  blink?: readonly [string, string]
  // True for what hangs in the sky and takes no room on the ground.
  isAloft?: true
}

export const GOLD = '#f5c542'
export const GREEN = '#5fd787'
export const ORANGE = '#d97757'
export const CYAN = '#56c8d8'
export const TEAL = '#4fb0a5'
export const BLUE = '#5b8def'
export const PURPLE = '#a78bfa'
export const PINK = '#e879c6'
export const RED = '#e5534b'
export const GREY = '#8b949e'
export const SLATE = '#4b5563'
export const NIGHT = '#1e2227'
export const WHITE = '#e6e6e6'

const NOTE = '#f2e58a'
const INK = '#6b5d1e'
const SUN = '#ffb347'

export const SPARK: Sprite = ['o.o.o', '.ooo.', 'ooooo', '.ooo.', 'o.o.o']
export const SPARK_LIT: Sprite = ['w.w.w', '.wow.', 'woooW', '.wow.', 'w.w.w']
export const SPARK_PALETTE: Palette = { o: ORANGE, w: '#f0a58a', W: '#f0a58a' }

export const COIN: Sprite = ['gg', 'gg']
export const COIN_PALETTE: Palette = { g: GOLD }

export const GEM: Sprite = ['..g..', '.gGg.', 'gGGGg', '.gGg.', '..g..']
export const GEM_PALETTE: Palette = { g: GOLD, G: '#ffe08a' }

/** Each generator's look, by its id. */
export const ART: Readonly<Record<string, Art>> = {
  prompt: {
    sprite: ['yyyyy', 'ykkky', 'yyyyy', 'ykky.', 'yyy..'],
    palette: { y: NOTE, k: INK },
  },
  script: {
    sprite: ['ddddddd', 'dgbbbbd', 'dbgbbbd', 'dgbwwbd', 'ddddddd'],
    palette: { d: GREY, b: NIGHT, g: GREEN, w: WHITE },
    blink: ['w', NIGHT],
  },
  subagent: {
    sprite: ['..l..', '.ttt.', 'twtwt', 'ttttt', '.ttt.', '.t.t.'],
    palette: { t: TEAL, w: WHITE, l: GOLD },
    blink: ['l', RED],
  },
  mcp: {
    sprite: ['cccccc', 'clcccc', 'cccccc', 'clcccc', 'cccccc', '.k..k.'],
    palette: { c: CYAN, l: NIGHT, k: SLATE },
    blink: ['l', GREEN],
  },
  workflow: {
    sprite: ['pp...pp', 'pp.w.pp', '.wwwww.', 'pp.w.pp', 'pp...pp'],
    palette: { p: PURPLE, w: WHITE },
  },
  finetune: {
    sprite: ['b.b.b', 'b.b.w', 'w.b.b', 'b.w.b', 'b.b.b', 'b.b.b'],
    palette: { b: BLUE, w: WHITE },
  },
  rack: {
    sprite: [
      'ggggg',
      'glnlg',
      'ggggg',
      'gnlng',
      'ggggg',
      'glnlg',
      'ggggg',
      'ggggg',
    ],
    palette: { g: GREY, l: GREEN, n: NIGHT },
    blink: ['l', NIGHT],
  },
  datacenter: {
    sprite: [
      '..ssssss..',
      'ssssssssss',
      'swswswswss',
      'ssssssssss',
      'swswswswss',
      'ssssssssss',
      'ssssssssss',
    ],
    palette: { s: SLATE, w: CYAN },
    blink: ['w', BLUE],
  },
  fusion: {
    sprite: [
      '...mm...',
      '..mmmm..',
      '.mmwwmm.',
      'mmwwwwmm',
      'mmmmmmmm',
      'kkkkkkkk',
    ],
    palette: { m: PINK, w: WHITE, k: SLATE },
    blink: ['w', GOLD],
  },
  orbital: {
    sprite: ['bb.s.bb', 'bbsssbb', 'bb.s.bb'],
    palette: { b: BLUE, s: WHITE },
    isAloft: true,
  },
  dyson: {
    sprite: ['.o.y.o.', '..yyy..', 'oyyyyyo', '..yyy..', '.o.y.o.'],
    palette: { y: SUN, o: GREY },
    blink: ['o', WHITE],
    isAloft: true,
  },
  brain: {
    sprite: ['.ppppp.', 'p.ccc.p', 'p.cwc.p', 'p.ccc.p', '.ppppp.'],
    palette: { p: PURPLE, c: CYAN, w: WHITE },
    blink: ['w', PINK],
    isAloft: true,
  },
}

// The balance's own digits, three pixels wide and five tall.
export const DIGIT_HEIGHT = 5
export const DIGITS: Readonly<Record<string, Sprite>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '#', '#'],
}
