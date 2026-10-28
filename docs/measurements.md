# Measurements from the real game (Checkpoint B)

Link's movement constants, measured in Dolphin 2606 on G4SE01 rev 0 by reading RAM every frame. All numbers come from
`ref/save-lake-hylia.sav` (boss010 Lake Hylia, room 1, single player steering the 4-Link formation with a GameCube
controller), so they describe the **leader in formation mode**; free (non-formation) and Shadow Battle movement may
differ. Confidence: **confirmed** = read directly from RAM, reproduced across runs and matched by the sim to ~0.001 px;
*measured* = consistent observations, but the rule is inferred; *hypothesis* = not tested.

## Index (the notes are split by area; section names are unchanged)
- [measurements/walking-and-sword.md](measurements/walking-and-sword.md): "Method", "Walking", "Collision", "Room changes", "Sword", "Sim constants".
- [measurements/battle-combat.md](measurements/battle-combat.md): "Lifting, throwing, rolling, damage and items", "What the Shadow Battle sim uses", "Battle measurements: combat", "Items, levels and the Four Sword", "The Pegasus Boots", "The Magic Hammer and the Fire Rod, traced", "Fire on pots, orbs and soldiers, and the plain pit, traced".
- [measurements/battle-constants.md](measurements/battle-constants.md): "Battle constants from main.dol", "Audit after the float-op disassembler fix".
- [measurements/battle-arenas.md](measurements/battle-arenas.md): "Battle mode in Dolphin", "Battle measurements: arenas, orbs and camera".
- [measurements/screens.md](measurements/screens.md): "Renderer checks by RAM pokes", "J2D screens in Dolphin", "The title screen's sky in Dolphin", "Shadow Battle's round screens in Dolphin", "The Links' intro, the round's end and the HUD in Dolphin", "The pause screen in Dolphin", "The message window and the HUD's disc in Dolphin".
- [measurements/side-rooms.md](measurements/side-rooms.md): "Side rooms".
- [measurements/battle-open-items.md](measurements/battle-open-items.md): "Shadow Battle's open items, traced".
- [measurements/adventure-lake-hylia.md](measurements/adventure-lake-hylia.md): "Adventure: rooms, doors, enemies and Force Gems", "swimming, ledges, formations and Lake Hylia's way through", "formations against walls", "cannons and side-view doors", "the followers in a side view", "the Links apart, waterfalls", "room 58's caves, the raft, area 7".
- [measurements/adventure-enemies.md](measurements/adventure-enemies.md): "Adventure: generators, kills and drops", "Adventure: the sword soldiers".
- [measurements/adventure-world1.md](measurements/adventure-world1.md): "Adventure: signs and dialogue", "the Cave of No Return", "Tingle's Tower and Hyrule Castle, loading them", "Hyrule Castle rooms 5 and 6", "Hyrule Castle room 58's area 2", "Hyrule Castle room 10", "Hyrule Castle room 11: Phantom Ganon".
- [measurements/open.md](measurements/open.md): "Not measured / open".
