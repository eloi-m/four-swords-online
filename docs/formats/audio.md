# FSA formats: audio (JAudio2)

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## Audio (`AudioRes/`, JAudio2) — code in `packages/audio`, CLI `tools/audio`, player `apps/sound-test`
FSA runs the JAudio2-era engine (between Wind Waker and Twilight Princess): a BAA init archive, the JAudio2 BMS
dialect, and both IBNK versions. Everything below is big-endian.

### Files
- **confirmed** `JaiInit.baa` (172,800 bytes): wave systems, banks, sound tables, sound-effect sequences.
- **confirmed** `Waves/*.aw`: raw sample data, addressed by WSYS offsets. `main.dol` only knows
  `GC4Sword_usa/AudioRes/Waves/`. `Banks/{2ndLoad_0,4sword_0,defaultSE_0}.aw` are older builds of the same archives
  (CVS dates 2 March vs 23 March for `Waves/2ndLoad_0.aw`), smaller than where the WSYS data ends: stale, never read.
- **confirmed** `Seqs/JaiSeqs.arc`: uncompressed RARC with 52 `.bms`; the RARC file id is the sequence's resource id.
  `filed_w_test.bms`, `house.bms` and `filed_w1.bms` aren't in the sound table (unused).
- **confirmed** `Stream/smw.ast`: 86.7 s stereo 44.1 kHz AFC stream, loop from sample 103,424. Nothing in the game
  refers to it (no path in main.dol or the BAA): probably a leftover.
- *hypothesis* `data.arc/audio/sound_data.szs` (Yaz0, 1,924 bytes): little-endian data with Game Boy wave-channel
  patterns, likely sound for the GBA side. Not JAudio; not decoded.

### BAA container (**confirmed**)
`"AA_<"`, then commands until `">_AA"`: `"ws  "` id, offset, flags · `"bnk "` id, offset · `"bst "`/`"bstn"`/`"bsc "`
start, end (absolute offsets). FSA: `bst`, `bstn`, 5 × `ws` (ids 0, 1–4; flags −1, −1, 0, 0, 0, meaning unknown),
5 × `bnk`, `bsc` (45,760 bytes: the sound-effect sequences, below). Bank *n* uses the wave system of the same
index.

| ws | WSYS id | archive | waves | bank id | IBNK | programs |
|----|---------|---------|-------|---------|------|----------|
| 0 | 0 | 4sword_0.aw | 67 | 0 (all music) | v0 | 88 instruments + drums at 228 |
| 1 | 128 | defaultSE_0.aw | 23 | 128 | v1 | 22 |
| 2 | 129 | 2ndLoad_0.aw | 323 | 129 | v1 | 140 |
| 3 | 130 | MiyagawaBank_0.aw | 56 | 130 | v1 | 48 |
| 4 | 131 | NpcVoice_0.aw | 32 | 131 | v1 | 33 |

### WSYS (**confirmed**)
`"WSYS"`, size, id, wave table size, WINF offset, WBCT offset (offsets relative to `"WSYS"`). WINF: groups of
(char[0x70] .aw name, count, wave record offsets). Wave record (0x2C bytes): u8 ?, u8 format (0 ADPCM4, 1 ADPCM2,
2 PCM8, 3 PCM16), u8 base key, f32 sample rate, u32 offset + u32 size in the .aw, u32 loop flag (0/−1), loop
start/end (samples), sample count, s16 last + s16 penult. WBCT → SCNE → C-DF lists each record's wave id (low half
of a u32). FSA's 501 waves are all ADPCM4, 10.5–48 kHz. The stored history is the decoder state at the start of
the 16-sample frame containing the loop start (all 105 looped waves match our decoder exactly). `sampleCount` can
exceed the stored frames; looped waves wrap before the end.

### AFC ADPCM (**confirmed**, bit-exact)
16 samples per frame; 9-byte (4-bit) or 5-byte (2-bit) frames. Header byte: high nibble = scale exponent, low
nibble = one of 16 predictor pairs (the standard table, also in main.dol). `s = (r × 2^(e+11) + c1 s₋₁ + c2 s₋₂) >> 11`
for 4-bit (2^(e+13) for 2-bit), clamped to 16 bits, residuals most significant first.

### AST (**confirmed**)
0x40 header: `"STRM"`, data size, 0x09 u8 format (0 AFC, 1 PCM16), bits, channels, loop flag, rate, sample count,
loop start/end, block size, 0x28 volume. Blocks: `"BLCK"`, bytes per channel, 6 × (last, penult) = the ADPCM
history at the **end** of the block (all 428 channel blocks of smw.ast match), padding to 0x20, channel data.

### IBNK (**confirmed** layouts; only bank 0 is played so far)
`"IBNK"`, size, bank id, version. **v0** (bank 0): `"BANK"` + u32[240] program offsets: `"INST"` (volume, pitch,
2 oscillators, 2 + 2 effect offsets (all zero in FSA), key regions → velocity regions (wave = WSYS id << 16 | wave
id, volume, pitch)), `"PER2"` at 228 (128 per-key entries, s8 pan[128] at 0x288, u16 release[128] at 0x308).
Oscillator: target, rate, attack/release tables of (mode, time, value) points (modes 0–3 = curves, 13 loop, 14 hold,
15 stop), scale, vertex. All music envelopes are "jump to full, hold, release with a curve". **v1** (banks 128–131):
chunks `ENVT` `OSCT` `RAND` `SENS` `INST` `PMAP` `PERC` `LIST`; LIST points to `"Inst"`/`"Perc"` records.
*hypothesis (from JAudio2's behavior)*: only the first velocity region of a key region is used (bank 0 has one each).

### Sound tables (**confirmed**)
BST: `"BST "`, root → sections → groups → items (type << 24 | offset); sound id = section << 24 | group << 16 |
index. BSTN mirrors it with names. 840 sounds: section 0 "SE" (7 groups: SYSTEM_SE, PLAYER_VOICE,
PLAYER_MOTION, OBJECT_SE, CHAR_SE, MIYAGAWA_SE, NPC_VOICE), section 1 "BGM" (49). BGM items (type 0x11, 12 bytes):
u8 1, u8 0x40, u8 *v*, u8 0, u32 0, u8 slot, u24 sequence resource id. Slot is 2 for the short jingles (ITEM,
HAKKEN, FANFARE_LV2), 1 otherwise. *Hypothesis:* *v* is the sequence volume (55 for most, 45–80); we play at
0.34 × *v* / 55, which matches Dolphin's level for Lake Hylia (*v* = 55).

BGM index → sequence: 0 CHIJOU chijou · 1 FANFARE fanfare · 2 ITEM item · 3 SHINDEN shinden · 4 BOSS boss ·
5 RESULT result · 6 TITLE newtitle · 7 ATEMONOYA atemono · 8 BOCHI bochi · 9 DANGEON dangeon · 10 DEATH_MT dess ·
11 WATER_FIELD filed_w · 12 GANON ganon · 13 SHADOW_LINK heishi · 14 RAIN_FIELD heiya · 15 HIME hime ·
16 VILLAGE kakariko · 17 MORI mori · 18 SABAKU sabaku · 19 GANON_ROOM shinkan · 20 SHIRO shiro · 21 SNOW snow ·
22 TENKU tenku · 23 URANAI uranai · 24 URA_DANGEON uradangeon · 25 MUTEKI_F muteki_i · 26 SELECT select4 ·
27 CRYSTAL_ROOM crystal_ma · 28 MIKO miko1 · 29 KUMO kumo · 30 NIWA niwa · 31 SHADE shade1 ·
32 SWORD_FANFARE sword_fanfare · 33 BATTLE_ZAKO battle_zako · 34 ESCAPE escape · 35 HAKKEN hakken ·
36 HOGYOKU hogyoku · 37 TINCLE_HOUSE chinkuru_naka · 38 ENDING_DEMO ending_demo · 39 FANFARE_WIN fanfare_win ·
40 ENDING ending · 41 HOUSE house_new · 42 DAIYOUSEI megami · 43 SHADE_2 shade2 · 44 ARASUJI arasuji ·
45 FANFARE_LV2 fanfare_lv2 · 46 HOUSE_YAMI house_mori · 47 SAVE save · 48 DARK_VILLAGE kakariko_m.

### Stage BGM (**confirmed** for Lake Hylia)
main.dol @**0x804652F0**: u32[39] sound ids (0x010000NN = BGM NN), indexed by the map CSV's `bgmId`. Lake Hylia
(boss010, bgmId 2) → WATER_FIELD (`filed_w.bms`), matched against a Dolphin audio dump; boss021 → DARK_VILLAGE,
boss080/081 → TENKU, boss070/072 → SNOW, boss011 → DANGEON (`tools/audio stages` lists all). A second copy with 38
entries is at 0x8046F1C8. *Likely* (structure, not heard in Dolphin): Shadow Battle's `map500.csv` has one line per
arena room whose second field is the room's bgmId (it sits where the adventure maps' bgmId does, see "Shadow Battle
layout"): 24 → `JA_BGM_BATTLE_ZAKO` for The Field, Tower of Flames, Tower of Winds and Hyrule Castle, 16 →
`JA_BGM_BOSS` for Above the Clouds (rooms 4 and 9; entries 16 and 17 of the table are both BOSS). apps/battle plays
these (`BattleAudio.arenaBgm`).

### Shadow Battle sounds (apps/battle `sound.ts`; the fight's *hypothesis*: picked by name and by rendering; the side rooms' and the Tower of Winds' from the game's calls)
- Music: the arena BGM through the countdown and the round; `JA_BGM_FANFARE_WIN` when a round is won (the BGM slot),
  nothing on a draw; `JA_BGM_RESULT` once the match is over.
- Effects (all render with notes and no missing instrument): swing and stab `JA_SE_LK_SWORD_WIELD`; lunge the same
  plus the voice `JA_SE_V_SWORD_SWING`; charge full `JA_SE_LK_CHARGING`; spin `JA_SE_LK_TAMEGIRI` + `JA_SE_V_TAMEGIRI`;
  sword hit `JA_SE_CHR_ENEMY_DAMAGE` + the victim's `JA_SE_V_DAMAGE` (`JA_SE_LK_DAMAGE` itself starts no note); shield
  block `JA_SE_LK_SHIELD`; pit `JA_SE_V_FALL_DOWN`, then `JA_SE_V_DAMAGE_M` 58 ticks into the drop (**confirmed**,
  below); death `JA_SE_V_DOWN` + `JA_SE_LINK_DOWN`;
  countdown `JA_SE_READY`, fight `JA_SE_GO`, draw `JA_SE_HAZURE_JINGLE`; **confirmed** (Vaati's timer 0x802D3A18) each
  of the last 5 seconds `JA_SE_DEATH_COUNT_05` … `_01` and `JA_SE_DEATH_WARNING` at 30 s and 11 s left. Candidates
  left out: `JA_SE_LK_BUTTOBI` (blown away), `JA_SE_LK_FALL_MAGMA`, `JA_SE_LK_DAIKAITEN` and `JA_SE_V_KAITEN_L` (both
  loop), `JA_SE_START`, `JA_SE_JINGLE`, `JA_SE_LAST_COUNT`.
- **confirmed** (the ids main.dol's actors play, named through the BST: id = section << 24 | group << 16 | index)
  Explosions (HBMB, BMTY, BBMB's blast) 0x30001 `JA_SE_OBJ_BOMB_BURST`, as the cue already had it; the Tower of Winds'
  Shadow Link 0x4004E `JA_SE_CHR_SLINK_APP_EFF_S` as he comes (state 3) and 0x50085 `JA_SE_CHR_SLINK_MAKEBOMB` with
  the bomb (state 6); the giant bomb 0x3000F `JA_SE_OBJ_IBALL_BOUND` landing and 0x50026 `JA_SE_OBJ_DOUKASEN_SPARKBIG`
  every frame of its fuse (a held sound, looping: started with its burning, stopped with it); a bombchu's blast over water 0x30022 `JA_SE_OBJ_LUPY_WATER`.
- **confirmed** (main.dol, static: the Link's sounds go through 0x8024F0E8 (Link, id), an actor's through 0x801F0E34,
  2D system sounds (section 0 group 0) through 0x801F0D20; the Link's state handlers: entry table 0x804A7628, per-frame
  0x804A74E0) The side rooms, as `sound.ts` plays them:
  - a pit (state 50): `JA_SE_V_FALL_DOWN` at its entry (0x80291888) and `JA_SE_V_DAMAGE_M` at its counter 58
    (0x802912BC); `JA_SE_LK_FALL_DOWN` (0x20016) is passed nowhere as a constant (*likely* unused in battle);
  - a door or gate (state 28 entry, any screen): `JA_SE_LK_STAIR_GO_UP` (styles 0, 3, a gate from the TV),
    `JA_SE_LK_STAIR_GO_DN` (styles 1, 2, 23, 24, a gate from a side-view GBA screen; style 35 the other way round);
    out onto the TV (state 29, on his first step, counter 30): `JA_SE_LK_STAIR_COME_DN` or `_COME_UP`, then
    `JA_SE_LK_RET_GC`; out onto a GBA screen, a command to that GBA instead (it plays its own). No gate sound of its own
    (SVGT's update is empty);
  - The Field's house door (tiles 0x19C/0x19D): the Link's update (0x8028860C → 0x8029E508) opens it when he faces up
    with one half 10 px over him: both halves become 0x19E/0x19F (types 0x2A/0x2B) for good, `JA_SE_OBJ_DOOR_OPEN`
    (`JA_SE_OBJ_DOOR_KNOCK` and shut while some player's GBA is busy, *likely*); the sim does it (siderooms.ts
    `openDoors`);
  - a hole (state 30 entry): `JA_SE_V_FALL_DOWN` + `JA_SE_LK_HALL_IN`, no damage voice;
  - a cannon: `JA_SE_LK_TAIHOU_SET` getting in, `JA_SE_LK_TAIHOU_SHOOT` firing (and effect 90 on the TV),
    `JA_SE_V_FALL_DOWN` 72 frames after the shot (not played here: the sim's count restarts at the top edge);
  - a magic circle: the 2D `JA_SE_MG_SQUARE_APP` as it opens, `JA_SE_MG_SQUARE_DISAPP` as it closes (after its light
    counter, up to 110 frames: not modelled), `JA_SE_OBJ_MAGIC_SQUARE` every frame while at full size (held: a looping effect started then and stopped when it
    shrinks; `sound.ts` `holdSounds`, stopped while paused); `JA_SE_READ_RIDDLE` at full size for params bit 3 (none
    of the castle's);
    `JA_SE_LK_WARP_IN_DUN` taking a Link (state 36) and sending him back (32); back on the TV (33, counter 60)
    `JA_SE_LK_RET_GC_SMOKE` + `JA_SE_LK_RET_GC`; the dark side's middle spot `JA_SE_LK_MSPOT_WARP` (34), then
    `JA_SE_LK_RET_GC_SMOKE`, `JA_SE_LK_JUMP_UP` and `JA_SE_LK_RET_GC` coming down (35, counter 60);
  - the message window (main_message_window.blo, the same as "P2 down!"): its 2D `JA_SE_ATTENTION` (0x39) for
    "P2 down!" and for "You got 10 Dark World seconds!" (BMG 0xE8, shown once ({notice}) when a castle circle reaches
    full size, CIRC 0x8028AF6C); `JA_SE_ATTENTION_PINCH` (0x40) for "P2 down! −n!", "30 seconds left!", "Vaati arrives
    in 10 seconds!" and the giant bomb's landing message "A giant bomb! Escape to your Game Boy Advance!" (BMG 0x1A9,
    BBMB 0x80342E10). The message function 0x8043D67C takes the id − 1 ("The message window": the sound plays when
    the window takes the message). The circle's "10" is its sprite (enemy_gc_sob 302); main2D's main_diving.blo
    (kk_rupyNum digits in tk01/Pt01, tk02/Pt02 by a clock `kk_timer_01`, update 0x80432AF8) counts one player's
    timer in the one-player modes, not this. Each second of a Link's Dark World time (+0xBD8 % 60 = 0) sends his GBA a
    command (0x803037D4(player, 2)); what the GBA does with it wasn't seen.
- Several effects sound at once: `SynthMixer` (packages/audio `mixer.ts`) gives each its own synth from a pool of 8.
- Rollback-safe: a cue is computed from the state alone and keyed by the tick its cause started (`tick − actionTick`,
  `tick − modeTick`, `tick − phaseTick`, for the charge the tick the count reached `CHARGE.fullTicks`), firing only
  within 4 ticks of it, so re-simulated or re-shown states never play it twice.
- The level of effects against the BGM is unmeasured (effects at 0.34, BGM at its sequence volume).

### BMS sequences (**confirmed** decoding: 52/52 sequences, no unknown command)
- 00–7F note: key, u8 flags (voice = low 3 bits; voice 0 = gate note: velocity then a MIDI-style variable-length
  duration, bit 7 sweep from the last key, bit 6 tie), u8 velocity. 80–8F note off (voice = low 3 bits).
  90–9F register override (mask byte, then a command whose masked arguments are register indices).
- A0–FF: fixed-argument commands. The argument table was read from FSA's main.dol (parser table @0x80491E54,
  16-byte entries: handler + u16 count + u16 2-bit types u8/u16/u24/register); it equals Twilight Princess's except
  0xE7. Main ones: B8/B9/BA/BB timed param (volume 0, pitch 1, fxmix 2, pan 3, dolby 4, distfilter 5; 8-bit values
  expand to s16), C1 opentrack, C3/C4 call, C5/C6 ret, C7/C8 jmp, C9/CA table jump/call, CB/CC loop, D0–D7 ports,
  D8 regload, D9/DA reg ops, DC table load, E0 tempo, E1–E3 bank/program, E8 envelope, E9 ADSR, EB–ED filters,
  F0 wait (variable length), F1 wait u8, F3–F8 interrupts, F9 sync with the game, FD printf, FF finish.
  Registers ≥ 0x60 are track settings (0x62 timebase, 0x63 transpose, 0x64 bend sense, 0x6E–0x74 vibrato/tremolo…).
- Timing (**confirmed** against Dolphin: stable over 18 s): ticks/s = tempo × timebase / 60; the engine steps
  tracks at 400 sub-frames/s. All 52 sequences use timebase 120 (tempos 60–249, with ramps) and bank 0 only.
- Field themes (chijou, filed_w, kakariko, mori, sabaku, shiro, snow, tenku, shinden) open their 12 tracks from
  offset tables indexed by port 0: two variants each, and the root skips its intro wait when port 0 ≠ 0. 26 of 52
  sequences install an interrupt on port 0 writes that switches a low-pass (iircutoff 10) plus vibrato, or fxmix,
  on and off: *hypothesis* the game's "muffled music" switch (the leaf tracks' own port 0: `Synth.setTrackPorts`).
  What the game writes when wasn't found (pausing doesn't: it silences the music).
- Effects the data asks for (**confirmed**, all 52 sequences and the 791 effects' code): `iircutoff` 10/127 (and
  20, 30 in effects) and `param fxmix`; no `iirset`, `firset`, `busconnect`, dolby or distfilter param.
- *JAudio2 behavior, not measured on FSA:* pitch bend = value/32767 × bend sense × 4 semitones (bend sense 12 by
  default); register ops, loops, calls, ports and interrupts as implemented in `sequencer.ts`.

### Sound-effect sequences (**confirmed** decoding and lookup)
The `bsc` block is a JAudio2 sequence collection: `"SC"`, u16 table count (7), u32 size, u32[7] table offsets;
each table is u32 n + u32[n] offsets into the block. The 7 tables have exactly the item counts of the 7 SE groups
of the sound table, so sound (0, g, i) starts at table g entry i. Each entry opens a track with the effect's notes
(banks 128–131, e.g. `bankprg 0x8004`) and loops until its children are done; shared set-up code sits at the start
of the block. All 791 start offsets resolve; rendering them all gives 4,898 notes, none missing an instrument.
10 are silent: they start no note (JA_SE_LK_DAMAGE just finishes; others may depend on ports the game sets). 130
don't end within 5 s (looping effects that the game stops itself). 5 effects use the DSP waveform programs (below):
JA_SE_ITEM_NG and JA_SE_CHR_SL_COLOR_NG (two 0xF3 pulse beeps at key 45, ≈ 220 Hz), JA_SE_OBJ_CACTUS_HIT (0xF1 saw,
tied notes falling 45 → 36 → 48 → 41) use nothing else; JA_SE_OBJ_BOYOYON and JA_SE_CHR_DEGTAIL_BND (the same
"boing": an 0xF1 saw tied through 14 keys, plus one sampled note) mix them with a wave.

### DSP waveform programs (0xF0+)
Programs 0xF0–0xFF in any bank don't look up an instrument: JAudio2 starts a DSP voice whose sample source type is
program − 0xF0 (*assumed*: matches the type numbers FSA uses and Dolphin's HLE of the JAudio/Zelda ucode). Dolphin's
HLE generates them at the output rate, period 2^17 / ratio samples (ratio 4.12, so 1000 Hz at ratio 1): **0** square
±0.5, **1** saw (0 → full scale, wrapping to −full), **3** pulse (+0.5 for the first quarter, −0.5 after); 2 is
unknown (counted as missing). FSA uses only 0xF1 and 0xF3. The note pitch is 16736 / 32000 at key 60 (≈ 523 Hz; the
float 16736.016 is in main.dol's constants) and the default envelope has no attack and releases with (curve 1, 10
ticks, 0) then stops (the table and its oscillator record are in main.dol's data); the sequence's envset/simpleadsr
overrides it (the two NG beeps use one). Not compared with a Dolphin capture: no savestate triggers these effects.

### Playback model (`packages/audio/src/synth.ts`)
Modeled on JAudio2's channel update (formulas from its documented behavior, checked as a whole below). Per DSP
sub-frame: pitch = instrument × region pitch × wave rate / output rate × oscillator × 2^(bend + (key − base
key + sweep)/12 + vibrato); volume = (velocity/127)² × instrument × region × oscillator × track volume² (volume is
squared per track level) × tremolo; pan adds offsets around 0.5, equal-power stereo. Envelope times are in 1/600 s.
**Confirmed** for Lake Hylia against a Dolphin DSP dump (`tools/audio/src/capture.ts` + `compare.ts`): chroma
similarity 0.99 at the best offset (0.78 elsewhere), best at 0 semitones (±1: 0.67), level within 0.1 dB, octave
bands 62 Hz–4 kHz within 1 dB. Open: Dolphin has 12–21 dB more energy above 4 kHz (not correlated with our high
band: DSP resampling or ambient sound effects? not the reverb, below); the FIR filter, surround and voice priorities
aren't modeled; the DSP waveforms (0xF0+) aren't measured; the relative level of sound effects and BGM is
unmeasured.

### IIR filter and reverb (`packages/audio/src/effects.ts`)
FSA's DSP ucode is the one Dolphin's HLE calls the "Zelda" ucode (hash 0x2FCDF1EC, with MKDD and Pikmin 2); the
filter and FX line formulas below are as Dolphin emulates them, the parameters FSA's own.
- **IIR, confirmed (table, usage), formula as Dolphin:** `iircutoff n` loads entry n of a 128 × 4 s16 table
  (main.dol **0x8045C6B8**, read by the handler 0x8003477C into the track at +0x204; 0x7FFF,0,0,0 = off at 127). The
  table is a straight line from (3932, 2621, 18021, 14745) to (32767, 0, 0, 0), every value within 1 LSB.
  Per channel, on the resampled input before the volumes: y = c0·x[n−1] + c1·x[n−2] + c2·y[n−1] + c3·y[n−2],
  saturated to 16 bits (the live channel blocks at 0x807EF100, 0x180 bytes each, hold the mode word 0x20 = IIR on
  and the 4 coefficients at +0x148). Cutoff 10 (the muffle): +10 dB at 100 Hz, −0.7 dB at 1 kHz, −12 dB at 4 kHz,
  −17 dB at 8 kHz. A muffled render is 6 dB louder than the plain one (the bass gain), *unverified* on hardware.
  Synth rates other than 32 kHz move the poles and zero (p^(32000/rate)) and keep the DC gain.
- **Reverb, confirmed (RAM and main.dol):** 4 FX lines, all alike (main.dol **0x80491600**, 4 × 0x20: u8 enable, s16
  volume left at +4, right at +8, u32 buffer length 64 at +0xC, 8 FIR taps at +0x10 = 0,0,0,0,0,0,0x3FFF,0; copied
  into the DSP's block at 0x807F5100). A line's buffer delays 64 DSP frames (64 × 80 samples at 32 kHz); the
  pre-filter (tap 6 of 8: 2 samples later, ×½) feeds both the buffer back and the output (×0x6000 = ¾): out[n] =
  0.375·s[n−5122], s[n] = send[n] + ½·s[n−5122]. Channels send to lines 0 (0x0DC0 → left) and 1 (0x0E20 → right)
  at their left/right volume × fxmix (Lake Hylia's channel blocks: wet/dry = 0.354, 0.299, 0.275, 0.251, 0.116
  for fxmix 45, 38, 35, 32, 15 /127); lines 2–3 (the front reverb buffers) got nothing. One reverb for the BGM and
  all effects (`SynthMixer`). Cost: `pnpm --filter @fso/audio bench` mean ≈ 40 → 50 µs per 128-frame quantum (≈1.3 % of it).
- **Lake Hylia vs the Dolphin dump** (`compare.ts`, 19 s, before → after the reverb): chroma 0.942 → 0.943; level
  dump/render +0.5 → +0.4 dB; octave bands (dump vs render, level-matched) 62 Hz −1.9 → −1.8, 125 Hz −1.4 → −1.3,
  2 kHz +2.7 → +2.7, 4 kHz +11.1 → +10.8, 8 kHz +19.8 → +19.8 dB (the high-band gap isn't the reverb). The echo:
  autocorrelation of the onset envelope (spectral flux, 2 ms hops) at 160–162 ms is 0.043/0.039 in the dump,
  0.019/0.004 dry, 0.062/0.048 with the reverb (neighbouring lags ±0.02). The muffle has no Dolphin capture yet.
