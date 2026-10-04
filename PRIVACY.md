# Privacy

What the Token Tycoon mod for Claude Code does with data. Last changed on 4 October 2026.

## If you never use the global top

Nothing leaves your machine. The game keeps your save (the balance, what you own, your achievements and the counts below) and your two settings, `/tycoon hint` and `/tycoon close`, in the plugin's own Claude Code store, on your disk.

Of each tool call Claude makes, the mod reads the tool's name, to pay the call by its kind of work, and whether the call failed. It reads nothing of a call's arguments or output. Of each turn's end it reads one number: the output tokens the turn cost. What it keeps of these are counts: calls by kind of work, failed calls, turns and output tokens in all.

## If you use the global top

The global top is a leaderboard everybody who joins shares. It is off until you join, and it is the only thing in the mod that makes a network request. The requests go to one server, `claude-tycoon-board.barisdemirhan.workers.dev`, a Cloudflare Worker over a Cloudflare D1 database that Barış Demirhan runs.

What is sent:

- **Looking at the board** (`/tycoon top`, or the Top tab in the game) asks for a page of ten. If you have joined, it sends your id along to learn where you stand.
- **Joining** sends the name you chose, a random id and a random secret, both made on your machine. Pick a name you are fine with others seeing.
- **Your save**, when you join, when you look at the board, after a ship, and at the end of a turn, ten minutes apart at the least: the balance, what the run and the save have earned, how many of each generator you own, the upgrades and achievements you hold, your weights and ships, and the counts of calls by kind of work, failed calls, turns, clicks and generators bought. The output tokens Claude's turns cost are not in it, nor a tool's name, nor anything else of your session.

What the server keeps:

- Your name, your id and a SHA-256 hash of the secret. The secret itself stays on your machine.
- What your best save earned, when, and how many models it had shipped.
- Your latest save, as sent. It is kept so that a save that looks wrong can be read and removed.
- To slow a flood, a salted hash of the address a write came from. A later write clears these out once they are an hour old. The address itself is not stored. Cloudflare's edge also counts requests by address over a minute, to turn a flood away before it reaches the database.

What others see: your name, the tokens you have earned in all, your rank from Haiku to Mythos, and your place on the board.

The server runs on Cloudflare, which handles every request to it as the host. Nothing is sold, shared with anybody else or used for advertising, and the server runs no analytics.

## Taking your data off

`/tycoon leave` deletes your name and your save from the server, at once. Your id and secret then go from the plugin's store as well.

If you cannot run the command, [open an issue](https://github.com/barisdemirhan/claude-tycoon/issues) with the name on the board and it will be removed.

## Changes

This file's history in the repository is the record of what changed and when.
