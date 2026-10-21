# FSA formats: disc and containers

Part of the FSA file-format notes (index: [../formats.md](../formats.md)).

## Disc
- **confirmed** Image: RVZ v1, zstd level 19, 128 KiB chunks, NKit v1. Our reader (`packages/disc`) extracts
  `main.dol` with SHA-1 `d86b3d9f785566e34264035e140ef3daf3cc19f0`, matching the decomp projects' `build.sha1`.
- **confirmed** 167 files, 262 MB. Everything lives under `GC4Sword_usa/`; `CVS/` folders were shipped by accident.
- Top level: `Boss/` (stages), `data.arc` (shared graphics), `AudioRes/` (JAudio), `thpdemo/` (THP videos),
  `msgus.arc` (BMG text + font), `*2D.arc`/`entry.arc`/`result*.arc`/`map*.arc` (J2D UI screens + BTI), `Agb/` (GBA client program).

## Containers
- **confirmed** Yaz0 (`packages/formats/src/yaz0.ts`): every `.arc` and every `.szs` is Yaz0-compressed.
- **confirmed** RARC (`packages/formats/src/rarc.ts`): big-endian, offsets relative to 0x20. Root node name = archive
  name (e.g. `boss010`).
