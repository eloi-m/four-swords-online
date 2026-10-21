# FSA file formats (G4SE01)

Working notes. Fill in as formats are confirmed. Status: **confirmed** = parsed by our code and checked against
the real disc; *hypothesis* = observed or taken from community notes, not yet verified.

References (read-only; EFSAdvent/FSALib has **no license**, so do not copy its code or data tables):
- EFSAdvent / FSALib (C#): https://github.com/Venomalia/EFSAdvent
- nbouteme's SOB notes: https://nbouteme.github.io/fsasobdoc/
- noclip.website (MIT, may be ported with attribution): https://github.com/magcius/noclip.website
- Dolphin's RVZ spec: https://github.com/dolphin-emu/dolphin/blob/master/docs/WiaAndRvz.md
- Audio: arookas/flaaffy docs (MIT, JAudio1 BMS/IBNK/WSYS for Mario Sunshine): https://github.com/arookas/flaaffy;
  zeldaret/tww and zeldaret/tp decomps (JAudio1/JAudio2), read as behavior references only, no code taken.

## Index (the notes are split by area; section names are unchanged)
- [formats/disc-containers.md](formats/disc-containers.md): "Disc" (RVZ/ISO, FST) and "Containers" (Yaz0, RARC).
- [formats/stages-and-tiles.md](formats/stages-and-tiles.md): "Stages", "Map layout CSV", "Tile layers", "Background tiles", "Animated tiles", "TV rendering pipeline", "Tile types".
- [formats/battle-arenas.md](formats/battle-arenas.md): "Shadow Battle layout (`boss500`)", "Shadow Battle backdrops", "Lighting and the Dark World", "Cloud shadows", "Switches".
- [formats/side-rooms.md](formats/side-rooms.md): "Side rooms (GBA screens)".
- [formats/sprites-and-actors.md](formats/sprites-and-actors.md): "Actor lists", "GX textures", "Sprites", "Actor graphics", "Shared graphics (`data.arc`)".
- [formats/j3d.md](formats/j3d.md): "J3D models", "The title screen's sky".
- [formats/jpa.md](formats/jpa.md): "JPA particles".
- [formats/j2d-and-bmg.md](formats/j2d-and-bmg.md): "2D screens (J2D BLO2)", "Notable screens", "Screen animations", "Shadow Battle's round screens", "Messages (BMG)", "Messages for Shadow Battle and the site".
- [formats/adventure.md](formats/adventure.md): "Phantom Ganon", "Signs and dialogue", "DOOR's open tiles", "The lifted grey stone".
- [formats/runtime-ram.md](formats/runtime-ram.md): "Runtime (RAM) notes" (savestate addresses).
- [formats/audio.md](formats/audio.md): "Audio (`AudioRes/`, JAudio2)": BAA, WSYS, AFC, AST, IBNK, sound tables, stage BGM, Shadow Battle sounds, BMS, playback model.
