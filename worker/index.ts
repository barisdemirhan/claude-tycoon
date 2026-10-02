// The leaderboard's server: a Cloudflare Worker over a D1 database. It takes
// no score as told. A player's save arrives whole, and the server reads it
// with the game's own rules to see that it adds up before it counts what the
// save has earned.

import { toSave } from '../hooks/bank'
import { RULES, flawOf } from '../hooks/sim'

type Env = {
  DB: D1Database
  ADMIN_TOKEN?: string
  WRITES: RateLimit
  READS: RateLimit
}
type Player = {
  id: string
  key_hash: string
  name: string
  name_key: string
  best: number
  best_at: number
  ships: number
  banned: number
}
type Body = Record<string, unknown>

// The board is read a page at a time: this many rows, this many pages.
const PAGE = 10
const PAGES = 10
const MAX_BODY = 100_000
const NAME = /^[\p{L}\p{N}_-]{2,16}$/u
const ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const KEY = /^[0-9a-f-]{32,64}$/
// The writes one address may make in ten minutes.
const HITS = 30
const HITS_WINDOW = 600
const HITS_KEPT = 3600
// When the board opened, in seconds. Nobody has played longer than since
// then, and the fastest play the rules allow earns far less in that time
// than this: a save that claims more is held back to be looked over.
const OPENED = Date.UTC(2026, 9, 2) / 1000
const DAY = 86_400
const CEILING_BASE = 1e9
const CEILING_POWER = 4

const answer = (body: unknown, status = 200): Response =>
  Response.json(body, { status })

const refusal = (error: string, status: number): Response =>
  answer({ error }, status)

const now = (): number => Math.floor(Date.now() / 1000)

/** The most a save may have earned by `at` and still go straight up. */
const ceilingAt = (at: number): number =>
  CEILING_BASE * (Math.max(0, at - OPENED) / DAY + 2) ** CEILING_POWER

const digestOf = async (text: string): Promise<string> => {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )

  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const bodyOf = async (request: Request): Promise<Body | undefined> => {
  const text = await request.text()

  if (text.length > MAX_BODY) {
    return undefined
  }

  try {
    const body: unknown = JSON.parse(text)

    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Body)
      : undefined
  } catch {
    return undefined
  }
}

const textOf = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** Where a player stands: null until a save of theirs counts. */
const rankOf = async (env: Env, player: Player): Promise<number | null> => {
  if (player.best === 0 || player.banned !== 0) {
    return null
  }

  const ahead = await env.DB.prepare(
    `SELECT count(*) AS ahead FROM players
     WHERE banned = 0 AND (best > ?1 OR (best = ?1 AND best_at < ?2))`,
  )
    .bind(player.best, player.best_at)
    .first<number>('ahead')

  return (ahead ?? 0) + 1
}

const playerOf = (env: Env, id: string): Promise<Player | null> =>
  env.DB.prepare('SELECT * FROM players WHERE id = ?1').bind(id).first<Player>()

/** The player the body's id and key name, or the refusal it earns. */
const known = async (env: Env, body: Body): Promise<Player | Response> => {
  const player = await playerOf(env, textOf(body.id))

  if (player === null || player.key_hash !== (await digestOf(textOf(body.key)))) {
    return refusal('forbidden', 403)
  }

  return player.banned === 0 ? player : refusal('banned', 403)
}

const addressOf = (request: Request): string =>
  request.headers.get('CF-Connecting-IP') ?? ''

/**
 * Counts a write against its address in the database, over a longer stretch
 * than the edge counts, which lets a good share of a flood through: true
 * once the address wrote too much. A write refused here is not counted, so
 * a flood reads the database and never writes to it.
 */
const isFlooding = async (env: Env, request: Request): Promise<boolean> => {
  const address = addressOf(request)
  const ip = await digestOf(`${env.ADMIN_TOKEN ?? ''}:${address}`)
  const at = now()
  const [, recent] = await env.DB.batch<{ hits: number }>([
    env.DB.prepare('DELETE FROM hits WHERE at < ?1').bind(at - HITS_KEPT),
    env.DB.prepare(
      'SELECT count(*) AS hits FROM hits WHERE ip = ?1 AND at > ?2',
    ).bind(ip, at - HITS_WINDOW),
  ])

  if ((recent?.results[0]?.hits ?? 0) >= HITS) {
    return true
  }

  await env.DB.prepare('INSERT INTO hits (ip, at) VALUES (?1, ?2)')
    .bind(ip, at)
    .run()

  return false
}

/** `POST /players`: takes a name, or changes the one a player has. */
const named = async (env: Env, body: Body): Promise<Response> => {
  const id = textOf(body.id)
  const key = textOf(body.key)
  const name = textOf(body.name).normalize('NFC')

  if (!ID.test(id) || !KEY.test(key)) {
    return refusal('bad-request', 400)
  }

  if (!NAME.test(name)) {
    return refusal('bad-name', 400)
  }

  const nameKey = name.normalize('NFKC').toLowerCase()
  const holder = await env.DB.prepare(
    'SELECT id FROM players WHERE name_key = ?1',
  )
    .bind(nameKey)
    .first<string>('id')

  if (holder !== null && holder !== id) {
    return refusal('name-taken', 409)
  }

  const existing = await playerOf(env, id)

  if (existing === null) {
    await env.DB.prepare(
      `INSERT INTO players (id, key_hash, name, name_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(id, await digestOf(key), name, nameKey, now())
      .run()

    return answer({ name, best: 0, rank: null })
  }

  const player = await known(env, body)

  if (player instanceof Response) {
    return player
  }

  await env.DB.prepare(
    'UPDATE players SET name = ?1, name_key = ?2 WHERE id = ?3',
  )
    .bind(name, nameKey, id)
    .run()

  return answer({ name, best: player.best, rank: await rankOf(env, player) })
}

/** `POST /saves`: reads a save with the game's rules and counts what it earned. */
const saved = async (env: Env, body: Body): Promise<Response> => {
  const player = await known(env, body)

  if (player instanceof Response) {
    return player
  }

  if (body.rules !== RULES) {
    // A plugin older or newer than this server prices a save its own way.
    return refusal('other-rules', 426)
  }

  if (typeof body.save !== 'object' || body.save === null) {
    return refusal('bad-save', 422)
  }

  const at = now()
  const save = toSave(body.save, at * 1000)
  const score = save.lifeEarned

  if (score === 0 || flawOf(save) !== undefined) {
    return refusal('bad-save', 422)
  }

  const kept = JSON.stringify(save)

  if (score > ceilingAt(at)) {
    await env.DB.prepare(
      'UPDATE players SET save = ?1, claim = ?2, held = 1 WHERE id = ?3',
    )
      .bind(kept, score, player.id)
      .run()

    return answer({
      score,
      best: player.best,
      rank: await rankOf(env, player),
      // Kept off the board until the keeper has looked it over.
      held: true,
    })
  }

  const standing =
    score > player.best
      ? { ...player, best: score, best_at: at, ships: save.ships }
      : { ...player, ships: save.ships }
  await env.DB.prepare(
    `UPDATE players SET best = ?1, best_at = ?2, ships = ?3, save = ?4, claim = 0, held = 0
     WHERE id = ?5`,
  )
    .bind(standing.best, standing.best_at, standing.ships, kept, player.id)
    .run()

  return answer({
    score,
    best: standing.best,
    rank: await rankOf(env, standing),
    held: false,
  })
}

/** `POST /leave`: removes a player and their save. */
const left = async (env: Env, body: Body): Promise<Response> => {
  const player = await known(env, body)

  if (player instanceof Response) {
    return player
  }

  await env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(player.id).run()

  return answer({ left: player.name })
}

/** `GET /top`: one page of the board, and where the asking player stands on it. */
const top = async (env: Env, asked: number, id: string): Promise<Response> => {
  const players =
    (await env.DB.prepare(
      'SELECT count(*) AS players FROM players WHERE banned = 0 AND best > 0',
    ).first<number>('players')) ?? 0
  const pages = Math.min(PAGES, Math.max(1, Math.ceil(players / PAGE)))
  const page = Math.min(pages, Math.max(1, Number.isInteger(asked) ? asked : 1))
  const { results } = await env.DB.prepare(
    `SELECT name, best AS score, ships FROM players
     WHERE banned = 0 AND best > 0
     ORDER BY best DESC, best_at LIMIT ?1 OFFSET ?2`,
  )
    .bind(PAGE, (page - 1) * PAGE)
    .all<{ name: string; score: number; ships: number }>()
  const player = ID.test(id) ? await playerOf(env, id) : null

  return answer({
    top: results,
    page,
    pages,
    players,
    you:
      player === null
        ? null
        : { name: player.name, best: player.best, rank: await rankOf(env, player) },
  })
}

/** The keeper's own routes, behind the ADMIN_TOKEN secret. */
const kept = async (env: Env, request: Request, path: string): Promise<Response> => {
  const given = request.headers.get('Authorization') ?? ''
  const isKeeper =
    env.ADMIN_TOKEN !== undefined &&
    env.ADMIN_TOKEN !== '' &&
    (await digestOf(given)) === (await digestOf(`Bearer ${env.ADMIN_TOKEN}`))

  if (!isKeeper) {
    return refusal('not-found', 404)
  }

  if (request.method === 'GET' && path === '/admin/held') {
    const { results } = await env.DB.prepare(
      `SELECT name, claim, best, save, created_at FROM players
       WHERE held = 1 ORDER BY claim DESC LIMIT 100`,
    ).all()

    return answer({ held: results })
  }

  const body = request.method === 'POST' ? await bodyOf(request) : undefined

  if (body === undefined) {
    return refusal('bad-request', 400)
  }

  const nameKey = textOf(body.name).normalize('NFKC').toLowerCase()
  const id = await env.DB.prepare('SELECT id FROM players WHERE name_key = ?1')
    .bind(nameKey)
    .first<string>('id')

  if (id === null) {
    return refusal('not-found', 404)
  }

  if (path === '/admin/clear') {
    // A held save the keeper has read and found honest counts after all.
    await env.DB.prepare(
      `UPDATE players SET best = max(best, claim), best_at = ?1, claim = 0, held = 0
       WHERE id = ?2 AND held = 1`,
    )
      .bind(now(), id)
      .run()

    return answer({ cleared: body.name })
  }

  if (path === '/admin/ban') {
    const banned = body.banned === false ? 0 : 1
    await env.DB.prepare('UPDATE players SET banned = ?1 WHERE id = ?2')
      .bind(banned, id)
      .run()

    return answer({ name: body.name, banned: banned === 1 })
  }

  if (path === '/admin/remove') {
    await env.DB.prepare('DELETE FROM players WHERE id = ?1').bind(id).run()

    return answer({ removed: body.name })
  }

  return refusal('not-found', 404)
}

const WRITES: Readonly<
  Record<string, (env: Env, body: Body) => Promise<Response>>
> = {
  '/players': named,
  '/saves': saved,
  '/leave': left,
}

const routed = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/admin/')) {
    return kept(env, request, url.pathname)
  }

  const key = addressOf(request)

  if (request.method === 'GET' && url.pathname === '/top') {
    return (await env.READS.limit({ key })).success
      ? top(
          env,
          Number(url.searchParams.get('page') ?? '1'),
          url.searchParams.get('id') ?? '',
        )
      : refusal('slow-down', 429)
  }

  const write = request.method === 'POST' ? WRITES[url.pathname] : undefined

  if (write === undefined) {
    return refusal('not-found', 404)
  }

  if (!(await env.WRITES.limit({ key })).success || (await isFlooding(env, request))) {
    return refusal('slow-down', 429)
  }

  const body = await bodyOf(request)

  return body === undefined ? refusal('bad-request', 400) : write(env, body)
}

export default {
  // Two writes racing for one name end on the table's own uniqueness: the
  // loser hears that it failed, never a half-written row.
  fetch: (request: Request, env: Env): Promise<Response> =>
    routed(request, env).catch(() => refusal('failed', 500)),
}
