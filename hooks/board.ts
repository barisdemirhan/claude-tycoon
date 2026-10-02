// The global top as the plugin sees it: who the person is there, what to ask
// the leaderboard's server, and how to read what it says. Nothing here reaches
// the network or the store; the hooks module does, with what this hands it.

import type { TycoonBoard, TycoonRow, TycoonSave } from '../types'
import { fieldOf, toAmount, toCount } from './bank'
import { short } from './format'
import { RULES, rankOf } from './sim'

// The person on the global top: the name they took, and the id and the secret
// that make a save theirs. Nobody until they take a name; isOff once they have
// said not to be asked for one.
export type Player = {
  id: string
  key: string
  name: string
  // What the board has from them, and where that puts them: 0 until a save
  // of theirs counts.
  best: number
  rank: number
  isOff: boolean
  // Whether their latest save waits to be looked over, and when one was last sent.
  isHeld: boolean
  sentAt: number
}
/** What the leaderboard said: whether it did as asked, and a line on it. */
export type Told = { isDone: boolean; text: string }

const BOARD = 'https://claude-tycoon-board.barisdemirhan.workers.dev'
/** The board is read a page at a time: this many rows, this many pages. */
export const PAGE = 10
export const PAGES = 10
export const NOBODY: Player = {
  id: '',
  key: '',
  name: '',
  best: 0,
  rank: 0,
  isOff: false,
  isHeld: false,
  sentAt: 0,
}
export const NO_BOARD: TycoonBoard = {
  state: 'idle',
  top: [],
  page: 1,
  pages: 1,
  players: 0,
}
// What the server refuses with, as the person reads it.
const REFUSALS: Readonly<Record<string, string>> = {
  'bad-name': 'A name takes 2 to 16 letters, digits, - or _.',
  'name-taken': 'That name is taken. Try another.',
  'slow-down': 'The leaderboard is busy. Try again in a few minutes.',
  'bad-save':
    "The leaderboard could not make this save add up by the game's rules, so it does not count.",
  'other-rules':
    'The leaderboard plays by another version. Update the tycoon plugin to send saves.',
  banned: 'This name was taken off the leaderboard.',
  forbidden:
    'The leaderboard does not know this player any more. /tycoon leave, then join again.',
}
export const SILENT =
  'The leaderboard did not answer. What you earn stays on this machine.'

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

export const toPlayer = (value: unknown): Player => ({
  id: textOf(fieldOf(value, 'id')),
  key: textOf(fieldOf(value, 'key')),
  name: textOf(fieldOf(value, 'name')),
  best: toAmount(fieldOf(value, 'best')),
  rank: toCount(fieldOf(value, 'rank')),
  isOff: fieldOf(value, 'isOff') === true,
  isHeld: fieldOf(value, 'isHeld') === true,
  sentAt: toAmount(fieldOf(value, 'sentAt')),
})

/** The player with the id and the secret their saves go under, made once. */
export const enrolled = (player: Player): Player =>
  player.id === ''
    ? { ...player, id: crypto.randomUUID(), key: crypto.randomUUID() }
    : player

/** Where on the server a path is. */
export const urlOf = (path: string): string => `${BOARD}${path}`

/** A write to the server, as `$.http.fetch` takes it. */
export const posted = (body: Record<string, unknown>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/**
 * What of a save is sent: the game, with nothing of the session in it. When
 * it was last settled and the real tokens Claude's turns cost stay here.
 */
export const saveBody = (
  player: Player,
  save: TycoonSave,
): Record<string, unknown> => ({
  id: player.id,
  key: player.key,
  rules: RULES,
  save: { ...save, at: 0, stats: { ...save.stats, burned: 0 } },
})

/** A page of the board, with the id that asks where this person stands on it. */
export const topPath = (player: Player, page: number): string =>
  `/top?page=${page}${player.id === '' ? '' : `&id=${encodeURIComponent(player.id)}`}`

/** The page a word names: 1 to the last, or undefined for any other word. */
export const pageOf = (word: string): number | undefined => {
  const page = word === '' ? 1 : Number(word)

  return Number.isInteger(page) && page >= 1 && page <= PAGES ? page : undefined
}

export const refusalOf = (said: unknown): string =>
  REFUSALS[textOf(fieldOf(said, 'error'))] ?? SILENT

const standing = (rank: number, best: number): string =>
  `#${rank} on the global top with ◈${short(best)}`

/** The player as the server took them under a name. */
export const named = (player: Player, said: unknown): Player => ({
  ...player,
  name: textOf(fieldOf(said, 'name')),
  best: toAmount(fieldOf(said, 'best')),
  rank: toCount(fieldOf(said, 'rank')),
  isOff: false,
})

/** The player once the server has counted a save of theirs. */
export const ranked = (player: Player, said: unknown): Player => ({
  ...player,
  best: Math.max(player.best, toAmount(fieldOf(said, 'best'))),
  // A save held back to be looked over comes with the rank the last one had.
  rank: toCount(fieldOf(said, 'rank')) || player.rank,
  isHeld: fieldOf(said, 'held') === true,
})

const rowsOf = (said: unknown): TycoonRow[] | undefined => {
  const top = fieldOf(said, 'top')

  return Array.isArray(top)
    ? top.map((row: unknown) => ({
        name: textOf(fieldOf(row, 'name')),
        score: toAmount(fieldOf(row, 'score')),
        ships: toCount(fieldOf(row, 'ships')),
      }))
    : undefined
}

/** The page of the board the server sent, or undefined when it sent none. */
export const boardOf = (status: number, said: unknown): TycoonBoard | undefined => {
  const top = rowsOf(said)

  return status !== 200 || top === undefined
    ? undefined
    : {
        state: 'ready',
        top,
        page: Math.max(1, toCount(fieldOf(said, 'page'))),
        pages: Math.max(1, toCount(fieldOf(said, 'pages'))),
        players: toCount(fieldOf(said, 'players')),
      }
}

/** The player with where the board says they stand now. */
export const placed = (player: Player, said: unknown): Player => {
  const you = fieldOf(said, 'you')

  return you === null || you === undefined
    ? player
    : {
        ...player,
        best: toAmount(fieldOf(you, 'best')),
        rank: toCount(fieldOf(you, 'rank')),
      }
}

/** What a save that went up says, in a line. */
export const sentText = ({ rank, best, isHeld }: Player): string => {
  if (isHeld) {
    return 'Save sent. It shows on the global top once it has been looked over.'
  }

  return rank > 0 ? `You are ${standing(rank, best)}.` : 'Save sent.'
}

/** Whether this person is on the leaderboard, in a line. */
export const nameText = ({ name, best }: Player): string => {
  if (name === '') {
    return 'You are not on the global top. /tycoon name <name> joins it.'
  }

  return best > 0
    ? `You are on the global top as ${name}, with ◈${short(best)}.`
    : `You are on the global top as ${name}. What you earn goes up from here on.`
}

/** A row's place on the board, by its page and its place on the page. */
export const placeOf = (board: TycoonBoard, at: number): number =>
  (board.page - 1) * PAGE + at + 1

/** One row of the board: its place, what it earned, its rank and its name. */
export const rowText = ({ name, score, ships }: TycoonRow, place: number): string =>
  `${String(place).padStart(3)}  ${`◈${short(score)}`.padEnd(8)}  ${rankOf(ships).padEnd(6)}  ${name}`

/** A page of the board, and where this person stands. */
export const topText = (status: number, said: unknown): string => {
  const board = boardOf(status, said)

  if (board === undefined) {
    return SILENT
  }

  if (board.top.length === 0) {
    return 'Nobody is on the global top yet. /tycoon name <name> takes the first place.'
  }

  const { players, page, pages } = board
  const you = fieldOf(said, 'you')
  const rank = toCount(fieldOf(you, 'rank'))
  const yours =
    rank > 0 ? [`You are ${standing(rank, toAmount(fieldOf(you, 'best')))}.`] : []

  return [
    `Tycoon global top · ${players} ${players === 1 ? 'player' : 'players'} · page ${page} of ${pages}`,
    ...board.top.map((row, at) => rowText(row, placeOf(board, at))),
    ...yours,
  ].join('\n')
}
