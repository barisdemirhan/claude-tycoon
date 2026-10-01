// How the game writes its numbers: the pane, the hint line and the counter
// all read an amount the same way.

const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The number cut, never rounded up, to that many decimals. */
const cut = (amount: number, decimals: number): number => {
  const scale = 10 ** decimals

  return Math.floor(amount * scale + 1e-9) / scale
}

/** `1234567` as `1,234,567`: whole numbers only. */
export const grouped = (amount: number): string =>
  String(Math.floor(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** A count and what it counts: `1 call`, `1,200 calls`. */
export const counted = (count: number, word: string): string =>
  `${grouped(count)} ${count === 1 ? word : `${word}s`}`

/**
 * An amount as it is, below a thousand, and from there in three figures and
 * a unit: `0.1`, `15`, `1.50K`, `45.6M`. Past the last unit it is written as
 * a power of ten.
 */
export const short = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) {
    return '0'
  }

  if (amount < 1000) {
    return String(cut(amount, amount < 100 ? 1 : 0))
  }

  const tier = Math.floor(Math.log10(amount) / 3 + 1e-9)

  if (tier >= UNITS.length) {
    return amount.toExponential(2).replace('+', '')
  }

  const scaled = amount / 1000 ** tier
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0

  return `${cut(scaled, decimals).toFixed(decimals)}${UNITS[tier]}`
}

/** A price as it is asked: never shown lower than what is taken. */
export const price = (amount: number): string => short(Math.ceil(amount))

/** A stretch of time in its two largest units: `45s`, `12m`, `3h 20m`. */
export const span = (ms: number): string => {
  if (ms < MINUTE) {
    return `${Math.max(0, Math.floor(ms / 1000))}s`
  }

  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)}m`
  }

  const minutes = Math.floor((ms % HOUR) / MINUTE)

  return `${Math.floor(ms / HOUR)}h${minutes === 0 ? '' : ` ${minutes}m`}`
}
