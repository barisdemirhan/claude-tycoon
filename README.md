# claude-tycoon

Token Tycoon: an idle game that runs inside [Claude Code](https://claude.com/claude-code), where Claude's tool calls earn the money.

Type `/tycoon`, buy your first Prompt, and let Claude work. What you build is kept between sessions.

## Install

```sh
claude plugin marketplace add barisdemirhan/claude-tycoon
claude plugin install tycoon@claude-tycoon
```

Restart Claude Code, then run `/tycoon`.

## How it earns

- **Every tool call Claude makes pays tokens.** What it pays depends on the kind of work: reading, editing, shell, web, delegation to subagents, MCP tools. A call that failed pays half; one that was refused pays nothing.
- **Calls close together build a streak.** Each call within 20 seconds of the last raises the pay, up to a cap that upgrades lift. A minute of silence ends the streak.
- **The end of a turn pays a salary**, sized by the output tokens the turn really cost.
- **Generators make tokens every second**, from the Prompt up to the Matrioshka Brain. Each one bought costs 15% more than the last.
- **Generators run on unattended for as long as the context window lasts**: one hour after the last activity, up to a day with upgrades. Any tool call, in any session, starts the clock again, and a session that opens after time away says what was made.
- **You can mine by hand** with `space`, or a click on the scene, for a little.

The pane is the game's own screen: the balance in large digits, a scene where every kind of generator you own stands under the sky and a coin rises for each tool call, and under it the shop. Wide panes set the scene beside the shop; narrow ones, over it.

## What you keep

- **Upgrades** double a generator, raise what a kind of call pays, make every call also pay seconds of what the generators make, lift the streak's cap, and lengthen the context window. They open as you own more and as Claude calls more tools.
- **Achievements** each add 2% to everything, for good.
- **Shipping a model** gives up the run's tokens, generators and upgrades for weights. Each weight adds 5% to everything, for good, and the rank goes from Haiku up to Mythos.

The game is built to last: the last generators are out of reach until a few models have shipped.

## Play

| Key | Action |
| --- | --- |
| `space`, `m`, `enter` | Mine by hand |
| `1`-`9`, `0`, `q`, `w` | Buy the generator or the upgrade on that row |
| `x` | Buy 1, 10 or 100 generators at a time |
| `b` | On the upgrades tab, buy every upgrade the balance covers |
| `g` `u` `r` `p` | The Build, Upgrades, Records and Ship tabs |
| `y` | On the ship tab, ship: twice, since it gives the run up |
| `esc` | Give the keys back to the prompt |
| `ctrl+x` `tab` | Give the keys back to the game |

A click does what a key does: on a row it buys, on a tab it shows it, on the scene it mines.

| Command | What it does |
| --- | --- |
| `/tycoon` or `/tycoon play` | Opens the game |
| `/tycoon stop` | Closes the pane. The game goes on earning |
| `/tycoon stats` | The balance and the counts, as one line |
| `/tycoon hint` | Takes the balance off the hint line under the prompt, or puts it back. `/tycoon hint on` and `/tycoon hint off` say which |
| `/tycoon reset confirm` | Deletes the save |

## Requirements

- A Claude Code build with mod support (plugins that ship a hooks module). Built and tested on 2.1.287. Mods sit behind a rollout switch, so if `/tycoon` does not show up after installing, the switch may still be off for you.
- The terminal or the desktop app for the game's own screen. Other surfaces get the same game as buttons and text.
- A pane at least 36 columns wide and 10 rows tall.

## What it does on your machine

The mod registers one slash command and draws one pane. It makes no network requests, reads no files and runs no processes. It never changes a prompt, a tool call or a tool's result.

It reads two things of each tool call Claude makes: the tool's name, to pay it by its kind and show it in the pane, and whether the call failed. It reads nothing of the call's arguments or output. Of each turn's end it reads one number: the output tokens the turn cost.

It saves two things in the plugin's own Claude Code store: the game (the balance, what you own, the counts above) and your one setting. Several sessions share that save. Each change reads it before writing it, so two sessions earn side by side; if both write in the same instant, the later one stands.

Its hooks, all in `hooks/register.tsx`:

- `session.start` registers the `/tycoon` command, loads the setting and settles the save, then passes the event on unchanged.
- `command.run` answers only the `/tycoon` command. Other commands never reach it.
- `ui.render` draws only the mod's own pane. It also adds the balance after the hint line under the prompt, leaving the hint itself as it is.
- `ui.message` acts only on the keys the mod's own screen posts. Any other message is passed on untouched.
- `ui.close` notes that the mod's own pane closed, and passes every close on.
- `tool.call` pays each call after it ran, as described above, and passes each call and its result on untouched.
- `turn.complete` pays the turn's salary and passes the event on unchanged.

The files under `tests/` run only under `claude plugin test`. They mount the pane in the test harness and are never loaded in a session.

## Develop

```sh
git clone https://github.com/barisdemirhan/claude-tycoon
claude plugin validate claude-tycoon/.claude-plugin/plugin.json
claude plugin test claude-tycoon
claude --plugin-dir claude-tycoon
```

`hooks/catalog.ts` is everything the game sells and awards, as data: a new generator, upgrade tier or achievement is a new row there. `hooks/sim.ts` holds the rules, `hooks/bank.ts` reads the save back from the store and `hooks/register.tsx` holds the hooks.

The screen is `hooks/game.tsx`, painted on the pixel canvas of `hooks/canvas.ts` with the sprites of `hooks/art.ts`. `hooks/screen.ts` says what each tab lists and what a key means there, for the screen and for `hooks/pane.tsx`, the buttons the other surfaces get.

## License

MIT
