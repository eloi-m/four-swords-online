# Netcode: rollback sessions, transports, lobby

Online play is GGPO-style rollback over a deterministic sim: every machine runs the whole game from everyone's
inputs, predicts the inputs that haven't arrived yet, and when a real input differs from the prediction, it
restores a snapshot and resimulates up to the present. Only inputs cross the network, never state (but for a
rejoining player's snapshot). Who is cut when a peer goes, and from which frame, is decided by one arbiter per match
(see Disconnects), so every remaining peer agrees.

```
 apps/netplay, apps/battle
   │  startNetMatch(lobby, start, { game, state, … })            packages/net/src/netmatch.ts
   ▼
 RollbackSession ── RollbackGame<S> { clone, step, hash } ──▶ packages/sim (stepGame, cloneGame, hashGame)
   │  SpectatorSession (followers, no prediction)
   ▼
 Transport: send(peer, bytes) / listen({ message, closed })   packages/net/src/types.ts
   ├─ PeerTransport ("auto"): WebRTC data channel when open, lobby relay otherwise
   │    ├─ WebRtcTransport (unordered, maxRetransmits 0)
   │    └─ RelayTransport (binary frames through the lobby WebSocket)
   ├─ LossyTransport (artificial latency / jitter / loss, for testing)
   └─ SimNetwork endpoints (virtual time, for tests)
 LobbyClient ◀──── WebSocket ────▶ tools/signal (rooms, slots, start, signaling, relay)
```

Everything under `packages/net` except `webrtc.ts` (RTCPeerConnection) runs in node and the browser; the session core
(`session.ts`, `spectator.ts`, `adapt.ts`, `protocol.ts`) has no DOM or node dependency.

## The game interface

```ts
interface RollbackGame<S> {
  clone(s: S): S;                              // deep copy (a snapshot)
  step(s: S, inputs: readonly number[]): S;    // one 60 Hz frame; may mutate s; returns the next state
  hash(s: S): number;                          // equal on every machine for equal states
}
```

For the sim it is three lines: `{ clone: cloneGame, step: (s, i) => stepGame(s, i, world), hash: hashGame }`.
`hashGame` (`packages/sim/src/hash.ts`) walks the serializable state generically, with object keys sorted and values
type-tagged (murmur3 mixing), so it keeps covering new GameState fields without maintenance. Sorting matters:
`cloneGame` doesn't preserve `createGame`'s key order, so a `JSON.stringify` hash would differ after a rollback.

Inputs are u16 button masks, one per player (the sim's `Button` uses 7 bits). What the game must guarantee:

- **Determinism**: the same state and inputs give the same next state on every machine and browser. Integer math
  (the sim uses 1/256 px), no `Math.random()`/`Date.now()` (seed a PRNG in the state from `start.seed`), no
  iteration order that depends on object identity, no floats whose rounding could differ (plain `+ - * /` on doubles
  are IEEE-exact everywhere; `Math.sin` & co. are not guaranteed identical across engines).
- **All mutable state lives in `S`** and `clone` copies all of it (no module-level counters, no caches the step
  reads back).
- **Cheap clone and step**: one clone per simulated frame, up to `maxPrediction` extra steps per rollback.
  Measured for 4 Links on Lake Hylia (node 22, M1 Pro): clone 0.32 µs, step 0.59 µs, hash 4.6 µs, and a full
  8-frame rollback (restore + 8 × (snapshot + step)) **8.4 µs**, 0.05% of a 16.7 ms frame.

## Frames and inputs

`S(f+1) = step(S(f), inputs(f))`; `session.frame` is the next frame to simulate and `session.state` is `S(frame)`.

- **Input delay** `d` (default 2): the local input sampled while simulating frame `f` is scheduled for frame `f + d`.
  With `adaptiveDelay: { min, max, interval? }` each peer moves its own `d` toward what its inputs need to reach every
  player in time (below), one frame at a time at most every `interval` ticks (30): going up, the tick's input is
  scheduled for two frames; going down, the next input is dropped (its frame is already scheduled). Inputs carry their
  frames, so the peers need not agree on `d`. Shadow Battle's rooms default to it (`MatchConfig.delay` `AUTO_DELAY`,
  from 2 within 1-6: the lobby's "Auto", `#delay=auto`). Frames `0..d-1` use input 0.
- **The adaptive delay's target** (`session.delayTarget`, frames): the largest, over the live players, of
  `(RTT/2 + RTT deviation) / 16.7 − (lead + 1) + 0.25`, smoothed over about half a second (EWMA 1/32 per tick).
  - *One-way latency*, RTT/2 (the RTT smoothed with gain 0.1 per packet, as for the time sync).
  - *Jitter*: the RTT's mean deviation (RFC 6298's RTTVAR, smoothed 1/16 per sample as RFC 3550's jitter), once
    (`DELAY_JITTER`). It already sums both directions' jitter and the ticks' quantization, and each packet resends
    every unacked input, so a late packet is often overtaken by the next: once is enough. Tried against fixed delays
    on 2–7 frames of latency with 0–3 frames of uniform jitter, it settles on the smallest delay that doesn't roll
    back, or one above.
  - *The frame grid*: our input for frame `f` arrives in time if it reaches the peer before *its* tick for `f`. The time
    sync keeps both peers on the same frame within about a frame, but not in phase: the peer whose ticks fall later
    in the 16.7 ms needs that much more delay, the other that much less. `lead` is our `localAdvantage` smoothed
    (1/64 per tick): how far our ticks run ahead of that peer's (`+ 1`: its packets carry the frame after the one it
    just simulated, ours the one we are about to). This term is exact whatever the routes' asymmetry: the advantage
    estimate's error from assuming RTT/2 one way cancels the RTT/2 above.
  - *Margin* 0.25 frame (`DELAY_MARGIN`): ticks and packet handling aren't instant (a browser's timer is ±1 ms).
  - *Hysteresis* (`adapt.ts`, shared with the spectators' buffer): `d` goes up as soon as the target passes it, but
    down only once the target is under `d − 1.5` (one frame less would still leave half a frame) at two checks in a
    row. Without it, a target wandering ±0.2 frame around an integer flaps every few seconds under jitter; with it,
    no peer turned back more than once in 20 runs of 30 s on each profile below.

  Under the previous rule (`d` toward RTT/2 ± 0.75), 4.2 frames of steady latency settled at 4 and rolled back on
  every other input change. Measured with the session tests' harness (2 players, scripted inputs that change every
  5–8 frames, P1 ticking 0–16 ms after P0, a spectator fed by P0 from the start, 20 seeds of 30 s each; rollbacks per
  second per peer and spectator stalls, ticks that played nothing, after a 3 s warm-up; `session.test.ts` "under link
  profiles" checks the same on one seed):

  | link (one way) | rollbacks/s before → after | settled `d` (P0/P1) before → after | spectator stalls in 27 s before → after |
  |---|---:|---:|---:|
  | steady 4.2 frames (70 ms) | 6.7 → 0 | 4/4 → 5/5, or 4/6 by phase | 0 → 0 |
  | 2 ± 1.5 frames (8–58 ms) | 4.2 → 0 | 2/2 → 4/5 or 5/4 | 479 → 2.5 |
  | 3 ± 0.5 frames, 2% loss | 5.5 → 0.06 | 3/3 → 4/4 or 4/5 | 30 → 7 |
  | 60–100 ms, 20% loss, 5% duplicated | 4.5 → 1.2 | 5/5 → 6/6 (the maximum) | 548 → 12 |
  | 2 → 6 → 2 frames (steps at 4 s, 9 s) | 4.2 → 1.0 (from 12 s on: 4.0 → 0) | ends 2/2 → 3 or 4 | 12 → 8 |

  The price is a frame of input lag more where the old rule rolled back.
- **Prediction**: a missing remote input repeats that player's last known input.
- **Prediction limit** `maxPrediction` (default 8): the session won't simulate frame `f` if some live remote player's
  inputs stop before `f - maxPrediction`. It stalls instead (`stalled = "prediction"`), and the local input of that
  tick is dropped. This bounds rollbacks to 8 frames and keeps peers within ~8 frames of each other.
- **Confirmed**: the last frame for which every player's input is known (`confirmedFrame`).
- **Final**: `S(f)` is final once every input before `f` is known. `onFinal(frame, state)` reports final states in
  order (replays, tests).
- **Settled**: the last frame whose inputs *every live player* reports holding (each packet carries the sender's
  confirmed frame). Settled frames can't change any more, even through a disconnect (below), so they are what
  desync detection compares and what spectators receive.

## advance(input): one local tick

1. Time out silent peers (interrupted after 750 ms, disconnected after 3 s, or 10 s if never heard).
2. **Rollback**: if received inputs contradict what a simulated frame used (tracked per frame in a ring of used
   inputs), restore the snapshot of the earliest wrong frame and resimulate to the present.
3. **Time sync** (below), then stall or simulate one frame: snapshot `S(frame)` into the ring (`historyFrames`,
   default 64), step with actual-or-predicted inputs.
4. Report newly final frames; hash every `hashInterval`-th (default 30) final state.
5. Update the settled frame; compare hashes; send one packet to every peer.

Received packets are decoded as they arrive (transport callbacks) but only recorded; all simulation happens in
`advance()`.

## Time sync

Each packet carries the sender's current frame and its measured *frame advantage* over the receiver. Locally,
advantage = `frame − (their last frame + (time since it arrived + RTT/2) / 16.7 ms)`. The skew toward a peer is
`(our advantage − their advantage) / 2`, smoothed (EWMA 0.1). Averaging both views cancels asymmetric one-way
latency. When the largest skew reaches `syncThreshold` (1 frame), the session skips one tick
(`stalled = "sync"`), at most once every `syncInterval` (10) ticks, which is a ≤ 10% slowdown, hardly visible.
A machine whose clock runs 1% fast stays within 3 frames of its opponent, versus 7 without sync, and rolls back
half as much (`session.test.ts`).

RTT comes from timestamps echoed in every packet (`ts`, `echo`, `echoDelay`), so no separate ping message is needed.

## Desync detection

Every `hashInterval` frames, the hash of the final state is kept. Once that frame is settled, it is sent in every
packet (a flag and 8 bytes, repeated until the next one, so loss can't lose it). A receiver compares it with its own
hash of the same frame once that frame is settled for it too. A mismatch raises
`{ type: "desync", peer, frame, local, remote }`. The first check covers frame 0, so different initial states are
caught at once.

## Disconnects

A peer **loses** another on timeout (3 s of silence), on transport close (the lobby's "left"), or on a bye packet
(`close()` sends two, carrying the last inputs). Losing a peer cuts nothing by itself: the peer stops talking to it and
reports the loss in every packet (flag Lost: `(reporter, target)`, with each one's rejoin frame so an earlier life's
reports expire); peers repeat every report they hold, so all of them learn who hears whom. A bye or the lobby's "left"
counts as the leaver losing everyone (he's gone for good: nobody waits for more reports).

**The arbiter** decides every cut (`arbitrate` in `session.ts`). Each peer computes its *group*: the live players it
reaches from itself through pairs that still hear each other. The arbiter is the group's lowest player (every peer of a
group computes the same one; `session.arbiter`). It cuts the players outside its group, then walks the rest in player
order, keeping each one who hears every player kept before him and cutting the others: two players it still hears who
lost each other (a partition between them) cost the higher one his place, after `ARBITER_GRACE_MS` (1 s), in case one of
them crashed (then the arbiter soon loses him too, and he is the one cut). When the arbiter itself goes, the others lose
it, it drops out of their group and the next player takes over. A player cut by the arbiter learns it from its packets
(the arbiter keeps sending it 30 more) and **drops out** (`dropped-us`: it loses everyone, so it is its own group and
plays on alone; `session.droppedOut`).

The **cut** is after the last of the player's inputs the arbiter holds: frames after it use `disconnectedInput`
(default 0; the battle uses a sentinel, `PLAYER_LEFT`, and takes the Link out in its `step`: see Battle integration).
Every packet lists the cuts `(player, frame, held)`; every peer adopts the arbiter's frame as is, and a peer that holds
fewer of that player's inputs (`held` below the cut) gets the rest from any peer that has them (flag Relay); until they
arrive, those frames are predicted and count as unconfirmed. Since a cut never moves once made, settled frames never
change: every peer's settled frame is at most the arbiter's reported confirmed frame, which is at most what it holds of
every player. (Before, each peer cut a player on its own and everyone adopted the lowest cut reported, GGPO's rule: a
partition A↔C in a 3-player match ended with everyone cut off, and when two players left at once, the lobby's word
that one had left could make a peer stop counting it before its lower cut of the other reached it through a third peer,
rewriting a settled frame: a false desync warning. `arbiter.test.ts` replays both.) Peers that had simulated past the
cut with real or predicted inputs roll back; frames already reported final are reported again with their corrected
state. The event is `{ type: "disconnected", player, frame, reason }`, where `reason` is ours if we had lost him too
(`timeout`, `closed`, `left`, `dropped-us`), else `reported`.

**Splits** (`verdict` in `session.ts`, `ONLINE_VERSION` 27). Only a majority cuts: counting the players still in (not
cut, not gone for good: a bye or the lobby's "left"), a side keeping more than half of them cuts the rest at once; a
side keeping fewer drops out; a tie (2–2, 1–1) goes to a **referee**, the lobby (`SessionOptions.referee`, the lobby's
`claim` message). Why the lobby: both halves of a split still reach it in practice (with the "auto" transport, a split
that both halves' lobby connections survive only happens when the relay fails too), it sees every claim in one order,
and a half that lost its lobby connection is the one that can't continue anyway (it can't rejoin anything). Rule: a
claim `{keep, cut}` is granted unless one of `keep` was cut by a claim granted before (in this match, since that
player's last rejoin); a majority's cuts are claimed too (no wait for the answer), so a half that cut early through a
stale view still loses to a tie the other half won first. Every peer of the losing or smaller side drops out
(`{type: "dropped", reason: "split"}`; `"cut"` when the arbiter cut us), not only its arbiter; no answer within
`REFEREE_WAIT_MS` (5 s) also drops out. Without a referee (the unit tests' default) a tie goes to the half holding the
lowest player. The battle page then rejoins the match with its key from the same lobby connection (the lobby takes a
`join` with our own key from a member already in the room), at most once a minute (`AUTO_REJOIN_MS`); otherwise the
"dropped" screen says the connection to the other players was lost. A split therefore ends with one game, and the other
half back in it (`arbiter.test.ts`: 2–2 with and without referee over 8 seeds, 3–1, 1–1, two silent crashes;
`tools/signal/src/netmatch.test.ts` "a 2–2 split over the relay"; e2e `battle-online.ts` `split`). Price: two players
who vanish together without their lobby connections closing (both lose their network) leave the other two in a tie,
which the lobby grants them (nobody else claims); with no lobby at all, the half without P1 drops out.

Two arbiters deciding the same cut differently (the first one crashing within a round trip of deciding) would make the
peers disagree; the session reports it (an `error` event) and keeps the lower one. Left as detection: the lobby could
confirm cut frames, but the frame the first arbiter picked needs inputs only it may have held (it cut after the last it
held), so a second arbiter adopting it could wait forever; the window is one round trip after a crash, and the outcome
is a desync warning, not a wrong game silently.

Measured (toy game, 40±20 ms, 10% loss): when a player leaves cleanly, the others stall for fewer than 10 ticks. A
crash freezes the others for the 3 s timeout (the "Waiting for P3…" banner shows after 750 ms), then they continue in
sync; a partition between two players the arbiter still hears, 4 s (the timeout and the grace). In Chrome, closing a
tab is noticed in 6–15 ms (bye packet, or the lobby's "left").

## Rejoining

A player who dropped (reloaded the page, lost the lobby connection) comes back into the running match in his own
slot. Until then the slot is cut as above; coming back *un-cuts* it at a frame `R` that every peer agrees on:

1. **Lobby.** Every member gets a secret `key` in its `welcome`; the battle keeps it in `sessionStorage` with the room
   code. `join` with `rejoin: key` while the match runs (or after the lobby connection dropped: the server first
   removes the stale member) puts the newcomer in the departed player's place: `start.players[p]` becomes his new
   member id, the others get `{t:"rejoin", player, id, match}` (before the room update, so player 0 doesn't take him
   for a spectator), and he gets the running match's `start` with `resume: true`.
2. **The ask.** The rejoiner's `startNetMatch` doesn't simulate yet: it asks every other player still in the room for a
   snapshot (`{resume: "ask", ch, sponsor}` through the lobby's `signal`), again every 2 s until it comes, and gives up
   after 20 s (`onResume(false)`). Only its *sponsor* (`sponsor: true`), the first other player in the room, answers;
   the others' sessions only learn that he asked (`rejoinSnapshot`). If the sponsor leaves, the next player is.
3. **The arbiter** makes the rejoin (in `arbitrate`, once he asked and the cut `c` is at least 1 s old): it picks `R` =
   max(its own next input frame, c + 2) and adopts it: p's inputs `c+1 … R-1` become `disconnectedInput` explicitly,
   the slot is live again from `R`. Every packet from then on carries the rejoin `(p, c, R)` (flag Rejoins), and every
   peer that adopts it repeats it. No peer can finalize frame `R + 1` before it knows: that needs the arbiter's input
   for frame `R`, which only travels in packets carrying the rejoin. Peers that predicted past `R` predicted
   `disconnectedInput`, exactly what the slot now holds up to its first real input, so adopting resimulates nothing.
   Cut reports older than the rejoin (`frame < R - 1`) are ignored from then on. Any peer that adopted it can hand out
   the snapshot (`rejoinSnapshot(p)` returns one once it has): a sponsor leaving mid-rejoin leaves the next one the
   same `R`, since only the arbiter picks it (`rejoin.test.ts`, "while the sponsor goes").
4. **The snapshot**: `S(F)` at `F` = the sponsor's settled frame + 1 (final everywhere, can't change any more), its
   hash, every player's inputs from `F` as far as the sponsor holds them, the cuts and rejoins. The state goes through
   a generic tagged binary codec (`codec.ts`: plain objects, arrays, typed arrays, Maps, -0, NaN), base64, in chunks
   of `signal` messages through the lobby (reliable; 10–40 KB for 4 Links 30 s into a battle, the most on the Tower
   of Flames).
5. **The rejoiner** decodes it, **checks `hash(S(F))` against the sponsor's** (a mismatch refuses the snapshot), and
   starts a `RollbackSession` at frame `F` with those logs (frames before `F` are never simulated again). Like a
   spectator joining late, it first catches up on frames whose inputs every live player has sent, up to
   `catchupFrames` (32) per tick, then plays normally; its inputs start at `R`. Meanwhile the others stall at most
   `maxPrediction` frames past `R` waiting for them (the same as a peer's start), and the desync check covers every
   hashed frame from `F` on, on every peer.

In the battle, the Link stays out until the next round (a new round revives every fighter: `PLAYER_LEFT` no longer
retires it); in free play (no rounds) it comes back where it stood on frame `R`, the first without `PLAYER_LEFT`
(`battleGame`, `ONLINE_VERSION` 20). A free room's matches take rejoins too (see Free play). If
the arbiter decides `R` and is gone before any packet says so, the next arbiter picks its own; a rejoiner who already
started from the first one's snapshot then sees two frames for his rejoin and drops out (an `error` event).

## Spectators

A spectator (`SpectatorSession`) is fed by one player, which feeds every member of the room who isn't one of the
match's players (the room's spectators, and a free room's players who came in after the start). In `startNetMatch` it
is the lowest player still in the lobby's room, not cut, and not back from a drop (a rejoined session lacks the frames
before its snapshot); every player computes the same one each tick, so when P1 leaves or is cut, P2 feeds the
spectators from then on (and keeps them when P1 comes back). The spectator follows whoever sends it a feed (any player's
settled inputs are the same), and counts the feed as gone after 6 s without one. That player sends every
player's **settled** inputs (flag Feed) from the spectator's ack onwards, up to 64 frames per packet. Spectators
never predict or roll back, never slow the players, and can join mid-match: they replay from frame 0 at up to
`catchupFrames` per tick (32 in the demo). They lag the players by about one RTT plus the input delay, plus their
buffer.

The **buffer** absorbs the feed's unevenness (the network's jitter, and the settled frame moving in steps as the
players' packets arrive): the spectator plays one frame per tick while its backlog is within the buffer, stalls a
tick when the backlog runs dry, and past the buffer drains the excess over several ticks (`1 + ceil(excess / 8)`
frames a tick, up to `catchupFrames`). It adapts like the players' delay (`adapt.ts`, the same hysteresis), between 1
and 30 frames, toward 8 × the mean deviation of the feed's *transit*: the arrival time of its live edge (in frames)
minus that edge's frame, sampled on packets that bring new frames and aren't full (64 frames: a catch-up packet, cut
short by the sender). A uniform jitter spans about four mean deviations and the backlog swings that much around its
mean; eight keeps it off both ends. The latency itself needs no buffer: it only shifts the live edge. `buffer: n`
fixes it. Before, the buffer was fixed at 4 frames and drained to empty in one tick once exceeded: on 2 ± 1.5 frames
of jitter the spectator stalled ~200 ticks out of 690 (and jumped ~50 times); now 0–4 per 27 s on every seed (8–9
frames of buffer, about the same lag: it was stalling its way behind anyway); on 60–100 ms with 20% loss, ~240 → ~10.
On a steady link the buffer stays at 1.

## Packet format

One datagram per peer per tick, big-endian. `PeerTransport` prefixes each one with a **channel byte**: the match's
number in the room in the low 7 bits (`StartInfo.match` & 127), and bit 7 set when the sender doesn't hear the
receiver over WebRTC (see Transports). It drops datagrams of another channel: a room plays match after match over the
same lobby connection, and the late packets of the match that just ended (byes, hash reports, stale inputs) would
otherwise cut players or raise false desyncs in the rematch (`tools/signal/src/netmatch.test.ts` fails without it).
WebRTC signals carry the same tag (`ch`). Then the session's header (27 bytes):

| offset | type | field |
|---:|---|---|
| 0 | u8 | magic `0xF5` |
| 1 | u16 | flags: 1 Inputs, 2 Hash, 4 Bye, 8 Cuts, 16 Feed, 32 Spectator, 64 Rejoins, 128 Lost, 256 Relay |
| 3 | u32 | sender's current frame |
| 7 | u32 | sender's confirmed frame + 1 (0 = none) |
| 11 | i16 | sender's frame advantage over the receiver × 16 |
| 13 | u32 | ack + 1: last frame of the receiver's inputs (or feed) the sender holds |
| 17 | u32 | ts: sender clock, ms + 1 |
| 21 | u32 | echo: last ts received from the receiver (0 = none) |
| 25 | u16 | echo delay: ms since that ts arrived |

Then, in this order, when the flag is set:

- **Cuts**: u8 count, then (u8 player, u32 frame + 1, u32 held + 1: the sender's last frame of his inputs) each.
- **Rejoins**: u8 count, then (u8 player, u32 cut + 1, u32 rejoin frame) each (see Rejoining).
- **Lost**: u8 count, then (u8 reporter, u8 target, u32 reporter's rejoin frame, u32 target's) each (see Disconnects).
- **Relay**: u8 count, then (u8 player, u32 start frame, u16 count, run-length pairs) each: a cut player's inputs up to
  his cut, from the receiver's `held` + 1.
- **Inputs**: u32 start frame, u16 count, then run-length pairs (u16 value, u8 run) covering `count` values. It
  carries the sender's inputs from the receiver's ack + 1 (oldest first, at most `maxInputsPerPacket` = 64), so
  every packet is a redundant copy of everything unacked, and loss or reordering only costs time, never data.
  Receivers keep inputs contiguous and drop anything past a gap.
- **Hash**: u32 frame, u32 hash.
- **Feed** (player → spectator): u32 start, u16 count, u8 players, then one run-length block per player.

Typical packets are 44–49 bytes, about 2.7 KB/s per peer at 60 Hz. Decoding rejects bad magic, truncation, trailing
bytes and bad runs, and the session counts such packets in `stats.badPackets`. Inputs more than 1024 frames ahead
of the receiver are ignored.

## Lobby and signaling server (`tools/signal`)

Dependency-free: a minimal RFC 6455 server (`websocket.ts`: handshake, masked client frames, fragments, ping/pong,
close handshake, 64 KB message cap, no extensions) plus rooms (`server.ts`). Text frames are JSON; the types are in
`packages/net/src/lobby.ts`.

| client → server | server → client |
|---|---|
| `{t:"create", name?, maxPlayers?, config?}` | `{t:"welcome", you, room, key}` (you = member id 1–255; `key`: secret, to rejoin) |
| `{t:"join", code, name?, spectator?, rejoin?}` (`rejoin`: our key, back into the running match) | `{t:"room", room}` on every change (`room.config`: the host's settings; `room.matches`) |
| `{t:"free", name?}` (join a free room, or open one) | (as for join; `room.free: true`) |
| `{t:"configure", maxPlayers?, config?}` (host, between matches) | |
| `{t:"role", spectator}` (between matches: watch, or take a free slot) | |
| `{t:"start", config?}` (host; again while a match runs = a rematch) | `{t:"start", seed, players, config, match, room, resume?}` (`players` = member ids by player index; replayed to late spectators, and with `resume` to a player rejoining) |
| | `{t:"rejoin", player, id, match}` (a player is back under member id `id`) |
| `{t:"end"}` (host: back to the room) | `{t:"end", room}` |
| `{t:"signal", to, data}` | `{t:"signal", from, data}` (WebRTC offers/answers/candidates) |
| `{t:"claim", match, keep, cut}` (a split's cut, see Disconnects) | `{t:"claim", match, keep, cut, ok}` |
| `{t:"leave"}` | `{t:"left", id}`, `{t:"error", message}` |

Binary frames are the relay: `[u8 member id][payload ≤ 2048 B]`, where the id is the destination going up and the
source coming down. Room codes are words: common 4- and 5-letter English nouns, easy to spell and to say over a call
(`words.ts`, 547 of them; each open room has its own, so `create` and `free` answer "server full" while every word is
taken; clients accept what a player types or pastes through `roomCode()`: any case, stray spaces, or a whole invite
link). The server fills the lowest free slot
(max 4 players, 8 spectators) and keeps slots contiguous when a player leaves (slot = Link color; a running match
isn't affected, it identifies players by member id). It refuses new players while a match runs (spectators are
fine), hands the host role over if the host leaves, drops a room when it empties, and pings every 20 s. `GET /`
returns a JSON status. **Free rooms** need no code: `free` puts a player in the first free room with a slot left or
opens one, hosted by its first member; they hold up to 8 players, who can join and change role while a match runs (they
get its `start` like a late spectator and play from the next one). Past member id 255 the server reuses the lowest id
not in the room nor in the running match's `players`; a later match's datagrams carry its number, so a reused id never
gets an older match's late packets.

**Hardening** that needs no extra infrastructure (`SignalServerOptions`; environment variables in `main.ts`):

| what | default | env |
|---|---|---|
| Origin allowlist: the upgrade is refused (403) unless the page's `Origin` is listed | any origin | `ALLOWED_ORIGINS=https://a.example,https://b.example` |
| Shared secret: the upgrade is refused (403) unless it carries `?token=<secret>` (compared in constant time); the battle pages read it from `<base>data/lobby-token` (a missing file means no token) | none (open) | `LOBBY_TOKEN=…` |
| Client address from the last `X-Forwarded-For` entry (the one your proxy appends) | socket address | `TRUST_PROXY=1` |
| Open rooms | 10 000 (never more than the room words: 547) | `MAX_ROOMS` |
| WebSocket connections in total / per address (503 beyond) | 5 000 / 32 | `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_ADDRESS` |
| Lobby messages per connection (token bucket; beyond: dropped with an error, closed after 100 strikes) | 20/s, burst 60 | |
| Relayed datagrams / bytes per connection (beyond: dropped, like a lossy network) | 1 200/s, 128 KB/s (bursts ×2) | |
| Failed joins (unknown code, full room…) before the connection is closed (code guessing) | 20 | |
| Settings (`config`) size | 2 KB | |

A 4-player host feeding 8 spectators through the relay sends about 11 × 60 = 660 datagrams/s, well under the cap.

```sh
node tools/signal/src/main.ts [port] [host] [-- command…]   # default 5185 on all interfaces (PORT / HOST env too)
pnpm signal                                                 # the same
pnpm battle:online                                          # the lobby + the battle dev server (its /signal proxy)
```

With a command after `--`, the server runs alongside it, passes `FSO_SIGNAL_PORT` in its environment, and both stop
together.

## Transports

- **WebRTC** (`webrtc.ts`): one RTCPeerConnection per remote member, with a negotiated data channel (`id: 0`,
  `ordered: false`, `maxRetransmits: 0`). The lower member id sends the offer. ICE candidates trickle through the
  lobby and are buffered until the remote description is set. The default ICE server is Google's public STUN; there
  is no TURN (the relay covers that role).
- **Relay** (`relay.ts`): the same datagrams through the lobby WebSocket. It is TCP, so it suffers head-of-line
  blocking, but works everywhere.
- **PeerTransport** (`peer-transport.ts`), mode `"auto"` (the default): packets go through the relay from the first
  frame and switch per peer to the data channel once it opens (and back if it closes). A match never waits on ICE.
  A data channel can also go quiet while it still reads "open" (a phone moving from Wi-Fi to cellular, a NAT
  rebinding, often in one direction only), which the channel only notices after tens of seconds, long after the 3 s
  disconnect. Every peer sends a packet per tick, so a channel that delivered nothing for 250 ms counts as down: packets
  to that peer go through the relay too, flagged "I don't hear you over WebRTC" (bit 7 of the channel byte), and a peer
  that receives the flag also sends through the relay for 500 ms after the last one (a channel dead the other way).
  Both paths deliver until the channel carries packets again; `route()` says `"relay"` meanwhile, and `rescued` counts
  the datagrams sent through the relay while the channel was open (`peer-transport.test.ts`; `tools/e2e/src/mobile.ts`
  kills one direction of a real data channel mid-match: no interruption). `iceTransportPolicy: "relay"` (the battle's
  `#ice=fail`) keeps ICE from ever connecting, with no TURN server, to test the fallback: the match plays on the relay
  from the first frame. `"webrtc"` and `"relay"` force one path. It tags datagrams with the match's channel byte (see
  Packet format), and
  `close()` stops its relay and WebRTC parts from listening to the lobby, whose connection stays open for the next
  match (`NetMatch.close({ quiet: true })` leaves without bye packets, for a rematch).
- **LossyTransport** (`lossy.ts`): artificial latency, jitter and loss on outgoing packets. It uses a queue drained by
  `pump()` (called every ~4 ms by the app) rather than timers, which hidden tabs throttle. `close()` flushes it.

## Battle integration (apps/battle)

The battle's online mode (menu → **Play online**) lives in its own files; `main.ts` only hands over its screens and
draws `online.game` while a net match runs:

| file | role |
|---|---|
| `online-game.ts` | the deterministic part, no DOM (tested in node: `online-game.test.ts`): `MatchConfig` (arena, hearts, time, wins, input delay, CPU players, a free room's mode and places; versioned), `parseConfig`, `initialBattle(spawns, config, players, seed)`, `initialFree` and `freeSpots` (free play and its restarts), and `battleGame(world)`, the `RollbackGame` that also takes departed players out and plays the CPUs |
| `online.ts` | the controller: lobby connection, create / join (into a running match: as a spectator), host settings (`configure`), start / rematch / end, free play (`keepFree`: the host's restarts), `startNetMatch`, the worker-timer ticker (`startTicker` from `@fso/web`), session events → banners, the results, the stats overlay |
| `lobby-ui.ts`, `online.css` | the DOM: connect panel, room (slots in Link colors, spectators, the host's settings, invite link), free play's name prompt and its bar over the map (the count, the host's Battle mode button), results with Rematch / Back to the room, the Esc menu, banners |
| `netstats.ts` | the stats overlay's text (`` ` `` key) |

```ts
// online.ts, on the lobby's "start" (the first match and every rematch):
this.endMatch(true);                                   // the previous match, quietly (no byes: everyone moves on)
const config = parseConfig(start.config);              // refuses another version or bad values
const state = initialBattle(arenaSpawns(stage, config.arena), config, start.players.length, start.seed);
const net = startNetMatch(lobby, start, {
  game: battleGame(world), state, ...delayOptions(config), disconnectedInput: PLAYER_LEFT,
  mode, impairment, onEvent, onFinal, onRoute, onSpectatorLost,
});
startTicker(() => net.tick(input.single()), () => net.pump());   // 60 Hz from a worker, hidden tabs included
// main.ts, every animation frame, as for a local match but without stepping:
//   if (online.game) { view.follow × online.takeFrames(); cues.observe(online.game); present(online.game) }
```

- **Identical initial state**: everything comes from `start.config` and the arena's `PLAS` starts; nothing local, no
  `Math.random`. The battle has no randomness yet; `start.seed` goes to `initialBattle` for when it does (seed the
  PRNG in the state there). Frame 0's hash is checked like any other, so peers with another disc or build get the
  desync warning at once.
- **CPU players** (`config.cpus`, levels): they take the Links after the room's players (as many as fit in 4) and
  are added to frame 0 by `initialBattle` (`addCpus`: their memory is part of the state, seeded from the lobby's
  seed). The session only has the room's players; `battleGame`'s step fills the CPU slots with `cpuInputs(state,
  world, inputs)` before `stepGame`, so every peer and spectator computes the same buttons from the same state and a
  rollback recomputes them. A room can start with one player and CPUs.
- **Departed players**: `disconnectedInput` is `PLAYER_LEFT = 0x8000`, above the sim's 7 button bits. `battleGame`'s
  step retires those Links (0 hearts, `dead`: not drawn, not hittable; stars kept) before and after `stepGame` (a new
  round revives every fighter), so every peer removes the Link at the frame after the session's cut, for the rest of
  the match. A 2-player round resolves at once; with 3–4 players the others play on.
- **Rematches** reuse the room: the host sends `start` again (new seed, `match` + 1); each peer closes its match
  quietly and starts the next, and the channel byte keeps the two apart. `end` goes back to the room, where players
  can join, switch to watching and back, and the host can change the settings.
- **Presentation tolerates rollback**: the HUD and the arena view are functions of the current state (the camera only
  eases once per new frame); the results screen opens on a *final* `matchOver` state and closes again if a disconnect
  report rewrites it. Sound cues (`sound.ts`) are keyed by the tick their cause started, so a state shown twice or a
  skipped frame plays each sound once; a predicted hit that gets rolled back has still been heard (a few frames of
  prediction, rare in practice).
- **Events**: `interrupted` → "Waiting for P3 (name)…" until `resumed`; `disconnected` → "P2 (name) left the match"
  (and "Everyone else left" when alone), or "P2 (name) lost the connection" after a timeout; spectators learn of
  departures from the lobby's `left`; `desync` → a red banner once, and the stats overlay opens with the first mismatch
  per peer.
- **Phones in the background**: iOS and Android stop a page when it goes to the background or the screen locks
  (frozen JS, or the back-forward cache, which closes its sockets). On a touch device, the page tells the other
  players when it goes to the background (`{ away, match }` through the lobby's `signal`), so theirs say "P2 (name)
  dropped out: their page went to the background" rather than just "left". Past the 3 s disconnect the others have
  cut it, so a page that comes back (a gap of 3 s or more between two ticks, or `pageshow` from the back-forward cache)
  ends its match (quietly: no byes from an earlier life of the slot) and rejoins it in its slot as a reload does
  (below; 300 ms later, so a lobby connection the freeze closed is seen closed first). Only without a rejoin record
  (no `sessionStorage`) it shows the "dropped" screen instead: watch the rest as a spectator (when at least two players
  go on), back to the room (the host brings everyone back; the others wait there for the next match; without the
  lobby connection it rejoins, as a spectator if the match still runs), or leave. `tools/e2e/src/mobile.ts` freezes
  pages with CDP `Page.setWebLifecycleState` (a rejoin, and the "dropped" screen with the record cleared).
- **Rejoining** (see Rejoining above): a player keeps `{server, code, key, match, free?}` in `sessionStorage` while a
  match runs (cleared when it ends, or he leaves). A reload lands on `#online` (`#free` for a free room's), which finds
  it and joins with the key; a lost lobby connection during the match, or the page back from the background, does the
  same without a reload. The match shows
  "Rejoining the match as P3…" until the snapshot arrives, then "Back in the match: in from the next round"; the
  others see "P3 (name) is back". The Link comes back at the next round.
- **Inputs**: each browser drives one Link with `LocalInput.single()` (P1's keyboard layout or the first gamepad),
  and 0 while the Esc menu or the results are open.

### Free play

The home page's Free Play (`battle/#free`) asks for a name, loads free play's map (`packages/sim/src/freeplay.ts`:
stage 4-2's field, 1024×768 px) and sends the lobby's `free`: no room screen, straight onto the map. Every match of a
free room is one of two kinds (`MatchConfig.mode`, `ONLINE_VERSION` 7):

- **`"free"`**: free play (the sim's `free` phase: every hit, throw and fall plays out, no heart is lost), up to 8
  Links. It never ends; it is *restarted*, a new match with a new seed, whenever the room's players change. The host
  (the room's first member; the next one when the host leaves) sends `start` again with `at`: where each Link stands
  in its view of the running match, `[member id, x, y, facing]` in px (Links out, players who left, aren't listed).
  Every peer builds frame 0 from it (`initialFree`: the players in `at` where they stood, newcomers on free spawns
  apart from them), so a join or a leave costs the others no more than a hitch: nothing about the old match is
  carried over but those positions, which the start message holds for everyone alike. The host restarts when no
  match runs, at once when one of the room's slotted members isn't a player of the running free play (a newcomer), and
  at once when one of its players left for good (`leave`, the Leave button). A player whose lobby connection dropped
  (a page in the background, a lost network, a closed tab or a reload) is *away* (`RoomInfo.away`, the lobby keeps it
  `FREE_AWAY_MS`, 2 min): no restart, his Link is out, and restarts meanwhile keep him in his place (the host's `start`
  with `keep`; a free room's restart keeps the running match's players in order, newcomers after them), absent from
  frame 0 (`SessionOptions.absent`: cut after frame -1, so he can rejoin at once) and where he stood (`at`). A page back
  rejoins its slot with its key (`join` with `rejoin`, a snapshot; its Link comes back where it stood) as P-same, with
  its name. Past 2 min the lobby drops him from `away` and the host restarts without him. A page that gets a free play without itself in it (the running one, replayed to a
  newcomer after `welcome`) waits for the host's restart ("Joining free play…").
- **`"battle"`**: the host's Battle mode button (2 players or more): a Shadow Battle on The Field for everyone in the
  room, with the default rules (3 hearts, no time limit, 3 wins; `#hearts=`, `#time=`, `#wins=` override them), up
  to 8 Links (the arena's 4 starts, then `moreSpawns`; no HUD corners past 4, the name tags stay up with each Link's
  hearts and stars). Players who come in meanwhile watch it (a player feeds them, as spectators); nobody restarts it.
  Eight seconds after its results (from final states, as usual), the host starts free play again for everyone in the
  room; a new host, or a battle left with fewer than two of its players, restarts free play at once. A player of the
  battle who drops out rejoins it with his key (his Link in from the next round).

A page frozen past the disconnect (a locked phone) rejoins its slot as above; once the match it dropped out of is over
or restarted, its key no longer counts and it comes in as a newcomer (a restart). Leave (the Esc
menu, the results) goes where the site's home link goes (the local menu when the battle app runs on its own).

Deep links (after `#`): `online`, `create`, `join=WORD` (`&spectate`), `free`, `name=`, `server=ws(s)://…`, `autostart=N`,
`arena=`, `hearts=`, `time=<s>` (any value up to 600), `wins=`, `delay=`, `players=<max>`,
`transport=auto|webrtc|relay`, `ice=fail`, `lag=&jitter=&loss=`, `finals` / `finals=0`. `create`, `join` and
`spectate` act once: the page takes them out of its address (a reload lands on the online screen, `#online`), and a
link pasted into the address bar of an open page reloads it to follow the link. An invite opened with no name (no
`name=`, none saved from an earlier visit) doesn't join at once: the page fills in the room's word and asks for a name
first; `free` with a `name=` goes straight into free play. The lobby server's field shows only with `server=`, a saved server of another address, or `#debug`. `window.fso.online` exposes the controller
(`current.net`, `finals`: the hash of every final state, recorded only under automation (`navigator.webdriver`, the
e2e tests) or with `#finals`, since hashing each frame costs players up to ~0.3 ms a tick on the busiest arena; `log`;
`lastDrop`; `script = (frame, state) => buttons` replaces the local input).

## Tuning

| option | default | notes |
|---|---:|---|
| `inputDelay` | 2 | Frames of input lag traded for fewer rollbacks. Roughly one-way latency in frames, capped at 3–4 for fighting-game feel. |
| `adaptiveDelay` | off (rooms: 1–6) | `{ min, max, interval = 30 }`: the delay follows `delayTarget` (Frames and inputs). |
| `maxPrediction` | 8 | Longest rollback, and how far ahead a peer may run. Above ~130 ms one-way (8 frames), peers stall. |
| `historyFrames` | 64 | Snapshot ring; must exceed `maxPrediction + 1`. Extra room serves disconnect cuts. |
| `maxInputsPerPacket` | 64 | Redundant resend window per packet. |
| `hashInterval` | 30 | Frames between desync checks (0 = off). |
| `interruptTimeout` / `disconnectTimeout` / `connectTimeout` | 750 / 3000 / 10000 ms | |
| `syncThreshold` / `syncInterval` | 1 frame / 10 ticks | |

Measured with `pnpm --filter @fso/net bench` (real sim on Lake Hylia, 60 s of scripted input that changes every
5–8 frames per player, so predictions are wrong far more often than with human play):

| network | players | delay | fps | rollbacks/s | avg / max length | stalled ticks | µs per advance() | B/s out |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| LAN 5 ms | 2 / 4 | 1 | 60.0 | 0 | 0 | 0% | 6 / 8 | 2.6 K / 7.8 K |
| 30±10 ms, 1% loss | 2 / 4 | 2 | 60.0 | 6 / 14 | 1.0 / 2 | 0% | 6 / 9 | 2.7 K / 8.1 K |
| 60±30 ms, 5% loss | 2 / 4 | 2 | 60.0 | 10 / 23 | 3.0 / 6 | 0% | 4 / 8 | 2.8 K / 8.5 K |
| 100±50 ms, 10% loss | 2 / 4 | 2 | 59.7 / 58.8 | 10 / 23 | 5.9 / 8 | 0.6 / 2.1% | 4 / 9 | 3.0 K / 9.0 K |
| 100±50 ms, 10% loss | 2 / 4 | 4 | 60.0 | 10 / 23 | 4.0 / 8 | 0.1% | 4 / 9 | 3.0 K / 9.1 K |
| 150±100 ms, 25% loss | 2 / 4 | 3 | 47.5 / 43.9 | 8 / 19 | 6.2 / 8 | 21 / 27% | 4 / 8 | 3.1 K / 9.2 K |

Every run ends with 0 desyncs. In headless Chrome (pages of one browser, `tools/e2e/src/netplay.ts`), every scenario
has identical hashes on all 661 frames:

- the relay with 60±30 ms and 10% loss: about 155 ms RTT, rollbacks averaging 3.3 frames;
- WebRTC with 100±40 ms and 20% loss: about 245 ms RTT, rollbacks averaging 6 frames (max 8), ~2–3% stalled ticks;
- 4 players on a full WebRTC mesh with 40±20 ms and 5% loss: about 100 ms RTT, rollbacks averaging 1.8 frames.

## Running

```sh
pnpm test                                                   # includes packages/net, tools/signal and apps/battle suites
pnpm --filter @fso/net bench                                # table above
node tools/signal/src/main.ts                               # lobby on :5185
pnpm battle:online                                          # lobby + battle on http://localhost:5181 (Play online)
pnpm --filter @fso/netplay dev                              # demo on http://localhost:5184
node tools/e2e/src/netplay.ts [frames=600]                  # headless multi-page check (starts and stops its own servers)
node tools/e2e/src/battle-online.ts                         # the same for online Shadow Battle (Vite 5187, lobby 5188)
node tools/e2e/src/free-play.ts                             # free play and its battle (Vite 5242, lobby 5243)
```

Demo: open http://localhost:5184 in two tabs (the dev server serves the game files from `extracted/`). Create a
room in one, then join it with the code or the invite link in the other, and the host starts. Arrows/WASD move,
J/Z swings. Deep links (after `#`): `create`, `join=WORD`, `spectate`, `autostart=N`, `name=…`,
`server=ws://host:port`, `transport=auto|webrtc|relay`, `delay=N`, `lag=ms&jitter=ms&loss=0.1`. The HUD shows
frame, rollbacks, stalls, and per peer the route, RTT and frame advantage. `window.fso` exposes the match for tests
(`fso.script = (frame) => buttons` replaces the keyboard).

Online battle: `pnpm battle:online`, then open http://localhost:5181 in two tabs or two browsers, **Play online** →
Create a room in one, join with the code or the invite link in the other; the host picks the settings and starts.
From another machine, remote players need the hosted setup below: browsers only allow the AudioWorklet (sound) on
`localhost` or HTTPS.

`battle-online.ts` checks, every scenario with identical hashes on every final frame of every page: the menus by hand
(create, join by typing the code, the host's settings reaching the guest, start, end from the Esc menu, watch
instead and play again, leave); a 2-player knockout on Hyrule Castle ("P1 wins" on both pages and on a spectator who
joined mid-match), then a rematch in the same room where P2 closes his tab mid-round (P1 wins the round and the
match); 4 players brawling under 60±30 ms and 10% loss (~155 ms RTT, rollbacks averaging 3.5 frames, max 8) with a
1.5 s outage of P3 (the others show "Waiting for P3", then resume) and P4 leaving mid-round (the other three play on
and the round ends); a forced desync (the warning and the stats overlay on both pages); rejoining: 3 players, P3 reloads mid-round and
comes back in his slot (his Link in from the next round), identical hashes on every page from his snapshot on; the
same over the relay with 40±20 ms and 5% loss, where P3's lobby connection then drops and the page rejoins again by
itself (`E2E_ONLY=rejoin` runs just those).

`free-play.ts` checks free play the same way: players joining one by one (the host's Battle mode button, the others
told who has it), a join and a leave restarting free play with the others where they stood (P5 in the yellow tunic,
no HUD corners, the name tags up), the host's battle for five with a latecomer watching it, "P1 wins" everywhere,
free play back 8 s later with the latecomer in, and the host leaving (the next member hosts).

## Hosting

Step-by-step deployment of the whole site (Docker Compose with Caddy, systemd, static hosting plus a lobby):
`docs/deploy.md`. The essentials:

Everything is static except the lobby server. A small VPS (any Linux with Node 22) is enough: the server keeps rooms
in memory and relays datagrams for peers whose WebRTC fails (about 3 KB/s per relayed peer).

1. **Build the site** (`pnpm build:site` → `apps/site/dist/`, every page; or just the battle app with
   `pnpm --filter @fso/battle build` → `apps/battle/dist/`) and serve it as static files. It
   contains no Nintendo data: the game files are served next to it at `data/` (`pnpm bundle`,
   `docs/deploy.md` "Game files").
2. **Run the lobby** with plain node, listening on localhost behind the proxy. It needs only the checkout
   (`tools/signal` and `packages/net`; no dependencies to install). For example as a systemd service:

   ```ini
   # /etc/systemd/system/fso-signal.service
   [Service]
   WorkingDirectory=/srv/four-swords-online
   ExecStart=/usr/bin/node tools/signal/src/main.ts 5185 127.0.0.1
   Environment=ALLOWED_ORIGINS=https://fso.example.org TRUST_PROXY=1
   Restart=always
   User=fso
   [Install]
   WantedBy=multi-user.target
   ```

3. **TLS through a reverse proxy** that serves the app and forwards `/signal` (a WebSocket) to the lobby. Pages on
   HTTPS must use `wss://`; the app defaults to `wss://<its own host>/signal`, so this needs no configuration (build
   with `VITE_SIGNAL_URL=wss://lobby.example.org` for a lobby on another host, or pass `#server=`). The Vite dev
   server does the same with a proxy to `FSO_SIGNAL_PORT` (default 5185). Caddy (automatic certificates):

   ```
   fso.example.org {
     root * /srv/four-swords-online/apps/battle/dist
     file_server
     handle /signal {
       rewrite * /
       reverse_proxy 127.0.0.1:5185
     }
   }
   ```

   nginx (inside the site's `server { … }` with its certificates):

   ```nginx
   location /signal {
     proxy_pass http://127.0.0.1:5185/;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_read_timeout 120s;
   }
   ```

4. Set `ALLOWED_ORIGINS` to the site's origin (so other sites' pages can't use your relay), and `TRUST_PROXY=1` only
   when the proxy is the only way in (otherwise clients could choose their address for the per-address cap). The
   defaults in the hardening table suit a small public server; `MAX_ROOMS` and `MAX_CONNECTIONS` bound its memory.

WebRTC uses Google's public STUN server by default and there is no TURN: peers behind symmetric NATs play through
the relay (the "auto" transport picks per peer; the stats overlay shows the route).

## Open problems

- **Arbitrated disconnects** (see Disconnects) trust the arbiter, the lowest player of the group: it decides who stays
  when two players lose each other (the higher one goes). Splits are refereed by the lobby (only one game survives).
  Two arbiters in a row deciding the same cut or rejoin differently (the first gone within a round trip of deciding) is
  detected, not repaired (why: Disconnects).
- **Free play**: a battle started from free play doesn't keep the players away (they come back as newcomers after it).
- **Signaling server**: origin allowlist, connection/room caps and rate limits exist (see the lobby section), but no
  accounts or auth (anyone with a room code can join or watch), no persistence (a restart drops every room), one
  process only (no sharding), and no TURN (the relay stands in, over TCP).
- **Battle, joining mid-match**: a player who joins while a match runs becomes a spectator, and can take a slot only
  once the host goes back to the room ("Back to the room", not "Rematch"). A player left alone keeps playing rounds
  against nobody until the match ends (the "Everyone else left" screen offers to go back to the room). Free play gets
  around it by restarting, which only works because nothing in it is at stake: the restart keeps where the Links
  stand, not what they hold or are doing (a lifted Link lands, a thrown one stops).
- **Battle, remote play needs HTTPS**: the AudioWorklet (sound) only works on `localhost` or HTTPS, so on a LAN IP over
  plain HTTP the synth can't start (no sound); use the hosted setup (or a tunnel with TLS).
- **Hidden-tab throttling**: the demo and the battle tick from a worker timer (`startTicker` in `@fso/web`), which
  Chrome and Firefox don't throttle today (`tools/e2e/src/site.ts` plays online matches with one of the two tabs in
  the background in both). Safari is untested (its engine plays online in Playwright's WebKit, `site-webkit.ts`).
- **Input delay** adapts to the measured latency, jitter and tick phase (`adaptiveDelay`, above), and the spectators'
  buffer to their feed's jitter; a fixed delay stays available. On a link whose latency swings by more than the
  delay can follow (one frame per half second), the climb still rolls back.
- **Cheating**: every peer sees every input and the full state (inherent to P2P rollback). Inputs are
  authenticated only by the transport.
