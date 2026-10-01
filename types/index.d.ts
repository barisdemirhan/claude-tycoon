/**
 * What a tool call is paid as: the kind of work the tool does. `turn` is no
 * tool's: it is what the end of a turn is paid as.
 */
export type TycoonFamily =
  | 'read'
  | 'edit'
  | 'bash'
  | 'web'
  | 'agent'
  | 'mcp'
  | 'other'
  | 'turn'

/** What has been counted since the save began: none of it resets on a ship. */
export type TycoonStats = {
  calls: number
  fails: number
  clicks: number
  turns: number
  /** The output tokens Claude's turns really cost, as their ends reported. */
  burned: number
  /** Generators bought, over every run. */
  bought: number
}

/**
 * The whole game as the store keeps it. `tokens` is the balance at `at`: what
 * the generators made since is worked out when it is read, never ticked.
 */
export type TycoonSave = {
  v: 1
  tokens: number
  /** When the balance was last settled, in milliseconds since the epoch. */
  at: number
  /** Earned since the last ship, and since the save began. */
  runEarned: number
  lifeEarned: number
  /** How many of each generator are owned, by the generator's id. */
  owned: Record<string, number>
  /** The upgrades bought this run, by id: a ship gives them up. */
  upgrades: string[]
  /** The achievements earned, by id: kept for good. */
  feats: string[]
  /** What ships have paid: each one raises every income, for good. */
  weights: number
  ships: number
  /** Calls counted per family, over every run: what opens a family's upgrades. */
  calls: Record<string, number>
  stats: TycoonStats
}

/**
 * What the pane shows: its tab, how many a buy takes, whether a ship waits on
 * its second press, and whether the pane is open at all.
 */
export type TycoonView = {
  tab: 'build' | 'upgrades' | 'records' | 'ship'
  qty: 1 | 10 | 100
  isArmed: boolean
  isOpen: boolean
}

/** The streak of calls close together, and when the last one came. */
export type TycoonCombo = { level: number; at: number }

/**
 * What the latest call paid and the tool that earned it, with how many calls
 * and clicks by hand this session has counted: the screen shows each new one.
 */
export type TycoonFeed = {
  gain: number
  tool: string
  calls: number
  mines: number
}

/**
 * How many keys the keys field has taken, which empties it for the next, and
 * the last press of the screen's own that was acted on.
 */
export type TycoonInput = { typed: number; acked: number }

/** What the person switched with `/tycoon hint`. */
export type TycoonSettings = { hasHint: boolean }

declare module 'claude-code' {
  interface PluginState {
    tycoon: {
      /** The save as last read or written, null until the first of either. */
      bank: TycoonSave | null
      view: TycoonView
      combo: TycoonCombo
      feed: TycoonFeed
      input: TycoonInput
      settings: TycoonSettings
      /** When the open pane was last told to draw again. */
      pulse: number
    }
  }
}
