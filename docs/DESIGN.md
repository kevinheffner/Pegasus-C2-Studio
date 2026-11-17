# Simulation Content Creator: Design

**Status:** Draft v0.1 (2026-11-17)
**Goal:** Produce still images and time-sequence videos that look like output from real 2D/3D military simulations and C2 (command and control) systems. That means MIL-STD-2525 / APP-6 unit symbols and tactical graphics on 2D maps and 3D globes, moving over time to depict an engagement.

Reference look: `example-outputs/eample-2d-map-with-symbols.png` (Esri "Military symbology styles" sample), the ArcGIS Military Overlay app, and the ArcGIS dictionary renderer 3D sample.

---

## 1. Key requirements

| # | Requirement | Notes |
|---|---|---|
| R1 | 2D map stills with blue and red unit symbols | Affiliation, echelon, HQ/TF modifiers, unique designation labels, status |
| R2 | Multipoint tactical graphics | FLOT/FEBA tooth lines, phase lines, boundaries (with echelon), objectives, axes of advance, obstacles, engagement areas. **This is what makes the sample image look real.** |
| R3 | Time-sequence video | Units move slowly along routes; graphics evolve; status changes (damaged/destroyed) |
| R4 | 3D views | Terrain-draped graphics, billboarded symbols on leader lines, optional 3D vehicle models |
| R5 | Multiple "looks" | ArcGIS-style topo overlay, dark C2 console, satellite/3D simulation |
| R6 | Swappable basemaps | MapTiler (Dark Matter, Topo, Satellite), OpenTopoMap, USGS, georeferenced UT Austin AMS scans |
| R7 | Deterministic, repeatable, high-res export | PNG up to 4K+, MP4/WebM/GIF at fixed FPS regardless of machine speed |
| R8 | Low or zero licensing cost | Open-source core; keyed services optional |

---

## 2. Component selection (researched)

### 2.1 Symbology

| Component | Role | Why | License |
|---|---|---|---|
| **milsymbol** (spatialillusions, v3.x) | Single-point unit, equipment, and installation icons | Zero deps, fast, renders 2525C/D/E and APP-6B/D/E, outputs canvas or SVG. v3 follows 2525E / APP-6E / FM 1-02.2. | MIT |
| **mil-sym-ts** (`@armyc2.c5isr.renderer/mil-sym-ts`, plus `mil-sym-ts-web` for browsers) | **Multipoint tactical graphics** (lines, areas, arrows, tooth lines, boundaries) and single-point icons | TypeScript port of the US Army C5ISR renderer used in Mission Command software. Supports 2525D/E and outputs **GeoJSON** that any map engine can draw. Fills the main gap milsymbol leaves. | Apache-2.0 |
| milgraphics (spatialillusions) | Fallback tactical graphics | Built on milsymbol, GeoJSON in, but marked as work in progress | MIT |
| ArcGIS Maps SDK dictionary renderer | *Optional* adapter for a pixel-exact Esri look | Esri's official 2525D/E and APP-6D/E web styles. Needs an API key; free tier is about 2M tiles/month. | Commercial (free tier) |

| map.army (gs-soft AG, MSS engine) | **External authoring tool and import source**, not an embedded engine | Free browser app with 2D/3D overlays, full 2525/APP-6 tactical graphics, PNG/JPEG/PDF/GeoTIFF stills, and **MilX / KML / NVG layer export**. No video, no time animation, no public API, and the engine (MSS) is closed and licensed. So we import its exported layers rather than script its UI. | Free to use; MSS commercial |

**map.army integration:** users can draw an overlay in map.army and export it as **NVG** (NATO Vector Graphics, an open XML format with SIDCs plus geometry) or MilX. `scc import overlay.nvg` converts it into scenario `units` and `graphics`, which our tool then animates and renders. KML import covers other tools too. This uses map.army for what it does well, fast standards-correct authoring, and fills its gap: motion and video.

**Decision:** Standardize scenarios on **2525D/E 20-digit numeric SIDCs** (APP-6D/E is code-compatible). Both milsymbol and mil-sym-ts consume them, so one scenario file drives icons and graphics. Provide a converter from legacy 2525C 15-character letter SIDCs for import.

### 2.2 2D map engine: **MapLibre GL JS v5**

- WebGL, vector and raster styles, terrain hillshade, and a globe projection (v5) for a cheap "semi-3D" look.
- Unit symbols: milsymbol canvas → `map.addImage()` → GeoJSON `symbol` layer. Avoid DOM markers so frames capture cleanly from the canvas and thousands of tracks stay fast.
- Tactical graphics: mil-sym-ts GeoJSON → `line`, `fill`, and `symbol` (label) layers. Tooth and decoration patterns come back as geometry from the renderer, not as CSS.
- Leaflet is the simpler alternative but is DOM/raster-based and weaker for video capture. Not recommended.

### 2.3 3D engine: **CesiumJS**

- True WGS84 globe, terrain, 3D Tiles, glTF models, time-dynamic entities (`SampledPositionProperty` gives interpolation for free), and a built-in clock/timeline.
- Units: milsymbol canvas → `Billboard` (the pattern in Cesium's own "Cesium and milsymbol" post; that post dates from 2016 and uses old APIs, but the approach still holds), with `heightReference: RELATIVE_TO_GROUND` and a vertical polyline "stick" to the ground, matching the ArcGIS 3D dictionary sample.
- Tactical graphics: the same mil-sym-ts GeoJSON → ground-clamped `Polyline` / `Polygon` (`classificationType: TERRAIN`).
- "Simulation look": optional glTF vehicle models (tanks, APCs, helicopters) oriented along heading, with muzzle-flash/smoke particle effects and fire lines between shooter and target.
- Alternative considered: deck.gl on MapLibre. Good for 2.5D, but weaker terrain and globe support. Kept as a possible later add-on.

### 2.4 Basemap and terrain sources

| Source | Look | Key? | Notes |
|---|---|---|---|
| MapTiler Dark Matter / Streets Dark | Dark C2 console | Free key | Your suggested link. Free tier has request limits. |
| MapTiler Topo / Outdoor | Closest to the sample image | Free key | Contours and hillshade |
| MapTiler Satellite | ISR/imagery look | Free key | Also usable as Cesium imagery |
| OpenFreeMap (Liberty/Positron/Dark) | Clean vector | **None** | Good no-key default |
| OpenTopoMap | Topographic raster | None (fair use, CC-BY-SA) | Very "military map" feel |
| USGS National Map Topo | US topo | None (public domain) | US only |
| Esri World Topographic | **Exact** match to sample | ArcGIS key | Via MapLibre raster or the ArcGIS adapter |
| **UT Austin AMS series** (maps.lib.utexas.edu/maps/ams) | Vintage Army Map Service sheets (1940s–60s) | None (US-gov public domain) | Scanned JPGs. Need an offline georeferencing step (Section 5). Gives a striking "paper map / historical" look. |
| Terrain: AWS Terrain Tiles (Terrarium) | Elevation for hillshade and 3D | None | Free and global |
| Terrain: MapTiler Terrain-RGB / Cesium World Terrain | Higher-quality elevation | Key (ion free tier) | |
| 3D: Cesium OSM Buildings / Google Photorealistic 3D Tiles | Urban 3D | Key | Google requires billing |

All sources go behind a `BasemapProvider` interface, so a scenario names a preset (`"basemap": "opentopomap"`) and API keys live in `.env`.

### 2.5 Video and image export

- **Primary (offline, deterministic):** Node + **Playwright** drives headless Chromium with GPU (`--use-angle`; SwiftShader fallback). The page exposes `window.scc.renderFrame(t)`, which sets sim time, updates layers, waits for the map's `idle` event (MapLibre) or `globe.tilesLoaded` + `scene.render()` (Cesium), and resolves. The driver then grabs the canvas pixels and pipes PNG frames to **FFmpeg** (via the `ffmpeg-static` npm package, since FFmpeg isn't installed system-wide here) → H.264 MP4 / VP9 WebM / GIF. Rendering speed doesn't depend on wall-clock time, so a 60 s video at 30 fps is exactly 1800 frames with every tile loaded.
- **Secondary (interactive):** in-app "Record" button using `canvas.captureStream()` + `MediaRecorder` for quick WebM previews.
- **Stills:** the same path, one frame, with a configurable `pixelRatio` for 4K/8K output.

---

## 3. Architecture

```
          ┌──────────────────────────── scenario.json ─────────────────────────────┐
          │ meta · ORBAT (units+SIDCs) · routes/waypoints · tactical graphics ·     │
          │ events (fires, status changes) · camera keyframes · look preset         │
          └──────────────┬──────────────────────────────────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐      ┌───────────────────────────────┐
          │  Scenario Generator (opt.)  │─────►│  Simulation Core (TS, pure)   │
          │  templates: meeting engmt,  │      │  fixed-step, seeded RNG       │
          │  defense, river crossing…   │      │  movement · formations ·      │
          └─────────────────────────────┘      │  simple attrition · events    │
                                               │  → state(t): tracks, graphics │
                                               └──────────────┬────────────────┘
                                                              │ state(t)
                     ┌────────────────────────────────────────┼─────────────────────┐
                     │                 Render Layer (browser) │                     │
                     │  ┌──────────────┐   ┌──────────────────▼─┐  ┌──────────────┐ │
                     │  │ Symbol Cache │◄──┤  View Adapter API  ├─►│ Look/Chrome  │ │
                     │  │ milsymbol +  │   │ setTime(t), camera │  │ HUD, banners,│ │
                     │  │ mil-sym-ts   │   └───┬────────────┬───┘  │ grid, scale, │ │
                     │  └──────────────┘       │            │      │ track table  │ │
                     │               ┌─────────▼───┐  ┌─────▼─────┐└──────────────┘ │
                     │               │ MapLibre 2D │  │ Cesium 3D │ (ArcGIS adapter │
                     │               └─────────────┘  └───────────┘   optional)     │
                     └───────────────────────┬──────────────────────────────────────┘
                                             │ window.scc.renderFrame(t)
                     ┌───────────────────────▼──────────────────────┐
                     │ Export CLI (Node): Playwright → frames →     │
                     │ FFmpeg → PNG / MP4 / WebM / GIF              │
                     └──────────────────────────────────────────────┘
```

### 3.1 Modules

| Package | Responsibility |
|---|---|
| `core/scenario` | JSON schema (zod), validation, 2525C→D SIDC conversion, MGRS/lat-lon parsing |
| `core/import` | NVG, MilX, and KML overlay import (e.g., from map.army) → scenario units/graphics; NVG export of any frame |
| `core/sim` | Pure, deterministic time-stepped engine: `state = sim.at(t)`. Route following (great-circle segments, speed by unit type, road snapping optional), formation offsets, contact detection, scripted and probabilistic attrition, events → SIDC status changes (present → damaged → destroyed), graphic updates (FLOT advancing) |
| `core/generator` | Procedural scenarios: pick an AO, lay a FLOT along terrain, place blue/red ORBATs by echelon doctrine (e.g., a BCT with 3 maneuver BNs and a red MRR), generate axes and objectives |
| `render/symbols` | Cached milsymbol canvases keyed by SIDC+modifiers+size; mil-sym-ts multipoint → GeoJSON |
| `render/view2d` | MapLibre adapter |
| `render/view3d` | Cesium adapter (billboards, leader lines, draped graphics, models, effects) |
| `render/looks` | Look presets: basemap, symbol size/outline, label font, HUD chrome |
| `app/` | Vite + TypeScript web app: scenario editor (place and drag units, draw graphics, timeline scrubber), live preview, record |
| `cli/` | `scc render`, `scc still`, `scc generate`, `scc tiles` (AMS georeferencing) |

### 3.2 Scenario format (sketch)

```jsonc
{
  "meta": { "name": "Meuse-Argonne demo", "start": "2026-03-01T05:30:00Z", "durationMin": 240,
            "standard": "2525D", "look": "arcgis-topo", "seed": 42 },
  "units": [
    { "id": "b-1-77", "sidc": "10031000161211000000", "designation": "308", "higher": "77",
      "echelon": "battalion",
      "route": [ { "t": 0, "pos": [4.96, 49.27] }, { "t": 90, "pos": [4.99, 49.29] } ],
      "speedKph": 6 },
    { "id": "r-76res", "sidc": "10061000181211000000", "designation": "76 RESERVE",
      "higher": "I RESERVE CORPS", "route": [ { "t": 0, "pos": [4.90, 49.30] } ] }
  ],
  "graphics": [
    { "id": "flot-blue", "sidc": "10032500001505000000", "points": [[4.85,49.25],[4.95,49.24]],
      "keyframes": [ { "t": 120, "points": [[4.86,49.26],[4.96,49.255]] } ] },
    { "id": "obj-223", "sidc": "10032500001513000000", "label": "OBJ HILL 223", "points": [...] },
    { "id": "bdy-1", "sidc": "10032500001401000000", "echelon": "division", "points": [...] }
  ],
  "events": [ { "t": 150, "type": "status", "unit": "r-76res", "status": "damaged" },
              { "t": 160, "type": "fire", "from": "b-1-77", "to": "r-76res", "durationS": 20 } ],
  "camera": [ { "t": 0, "center": [4.95,49.27], "zoom": 12 },
              { "t": 240, "center": [4.97,49.28], "zoom": 12.5, "pitch": 0 } ]
}
```

*(SIDCs above are illustrative. Generate real ones with the picker in the editor.)*

---

## 4. Looks (visual presets)

| Preset | Basemap | Symbology | Chrome | Emulates |
|---|---|---|---|---|
| `arcgis-topo` | Esri World Topo / MapTiler Topo / OpenTopoMap | 2525D filled frames, light blue/red, black labels | None (clean map) | Sample image / Military Overlay |
| `c2-dark` | MapTiler Dark Matter | Filled or unfilled frames, glow outline, monospace labels | Top bar with DTG (Zulu), MGRS cursor readout, MGRS grid overlay, scale bar, north arrow, track list panel, layer tree, alert ticker | Generic C2 / COP console |
| `c2-sat` | Satellite + grid | Unfilled frames, high-contrast | Same as c2-dark | ISR / FMV-style COP |
| `sim-3d` | Cesium terrain + satellite | Billboards on sticks, optional glTF models, fire effects | Sim HUD: sim clock, speed ×N, entity count | 3D constructive simulation |
| `vintage-ams` | Georeferenced AMS sheet | Hand-drawn-style graphics (thicker strokes) | Map collar | Historical / paper overlay |

**Guardrails:** UI chrome is **generic and original**. No real product logos, names, or screen layouts of specific fielded systems. A configurable marking banner (default `EXERCISE – SYNTHETIC DATA`) goes on every frame. It can be changed but is on by default, so generated media can't easily pass as real operational captures.

---

## 5. UT Austin AMS map pipeline

1. `scc tiles fetch <sheet-url>`: download the JPG.
2. Georeference. Most AMS sheets carry printed graticule or UTM grid ticks. Pick 4+ GCPs (from sheet-corner coordinates in the series index, or by clicking in the editor), then `gdal_translate -gcp …` → `gdalwarp -t_srs EPSG:3857`.
3. `gdal2tiles.py` (or `rio-pmtiles`) → local XYZ / **PMTiles** archive.
4. The MapLibre/Cesium raster source points at the local tiles; no key needed.

(GDAL runs via OSGeo4W/conda, or Docker `ghcr.io/osgeo/gdal`. Python/GDAL are not currently installed on this machine.)

---

## 6. Tech stack and repo layout

- TypeScript monorepo (npm workspaces), Node 26 (installed), Vite for the app.
- Deps: `maplibre-gl@5`, `cesium`, `milsymbol@3`, `@armyc2.c5isr.renderer/mil-sym-ts-web`, `mgrs`, `@turf/turf`, `zod`, `playwright`, `ffmpeg-static`, `commander`.

```
simulation-content-creator/
  docs/DESIGN.md
  packages/
    core/        scenario schema, sim engine, generator
    render/      symbols, view2d, view3d, looks
    app/         Vite web app (editor + preview + renderFrame hook)
    cli/         scc render | still | generate | tiles
  scenarios/     sample scenario JSONs
  assets/        glTF models, fonts, AMS tiles (gitignored)
  example-outputs/
```

### CLI examples

```bash
scc still  scenarios/argonne.json --view 2d --look arcgis-topo --t 0      --size 3840x2160 -o out/argonne.png
scc render scenarios/argonne.json --view 2d --look c2-dark     --fps 30   --speed 240x      -o out/argonne.mp4
scc render scenarios/argonne.json --view 3d --look sim-3d      --camera orbit               -o out/argonne-3d.mp4
scc generate --template meeting-engagement --ao "50.1,8.6" --blue BCT --red MRR -o scenarios/gen1.json
```

---

## 7. Phased plan

| Phase | Deliverable | Proves |
|---|---|---|
| **P1: 2D stills** | Scenario schema, milsymbol + mil-sym-ts on MapLibre, `arcgis-topo` and `c2-dark` looks, `scc still` | Reproduces the sample image |
| **P2: 2D video** | Sim core (routes, interpolation, status events), deterministic Playwright→FFmpeg export, camera keyframes | Slow-moving engagement MP4 |
| **P3: 3D** | Cesium adapter: terrain, billboards on sticks, draped graphics, orbit/fly cameras, `sim-3d` look | Matches the ArcGIS 3D dictionary sample |
| **P4: Editor, import, generator** | NVG/MilX/KML import (map.army overlays), interactive placement and drawing, timeline, procedural scenario templates | Non-programmer authoring, bulk generation |
| **P5: Extras** | AMS georeferencing pipeline, glTF models and fire effects, C2 HUD panels, optional ArcGIS adapter, batch rendering of N variants | Variety and realism |

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| mil-sym-ts browser build is less documented; only some graphics may render well | Spike it in P1 against the 10 graphics we need most (FLOT, FEBA, PL, boundary, OBJ, axis of advance, attack arrow, AA, EA, obstacle). Fall back to milgraphics or custom geometry for any gaps. |
| Tile loading makes frames incomplete | Wait for `idle` / `tilesLoaded` before every capture. Optional tile pre-warm pass. |
| Headless WebGL is slow without a GPU | Use Chromium with ANGLE/D3D11 on Windows (headed-offscreen if needed). SwiftShader works but is slower. |
| API-key limits (MapTiler, Esri, Cesium ion) | No-key defaults (OpenFreeMap, OpenTopoMap, AWS terrain). Cache tiles locally during renders. |
| Media mistaken for real operational imagery | Synthetic-data banner on by default, generic UI chrome, fictional unit designations from the generator |

---

## 9. Open questions

1. Primary output priority: 2D video first, or 3D?
2. Which standard should labels and frames follow by default: 2525D/E (recommended) or 2525C appearance?
3. Do you have, or want to create, keys for MapTiler, Cesium ion, or ArcGIS? Or should we start no-key only?
4. Real-world AOs (e.g., historical battles), fictional terrain, or both?
5. Target resolution and frame rate (1080p30? 4K60?).

## Sources

- milsymbol: https://github.com/spatialillusions/milsymbol
- mil-sym-ts (Army C5ISR renderer): https://unpkg.com/@armyc2.c5isr.renderer/mil-sym-ts@2.9.1/README.md, https://missioncommand.github.io
- milgraphics: https://github.com/spatialillusions/milgraphics
- map.army: https://www.map.army/about/en.html
- Cesium + milsymbol: https://cesium.com/blog/2016/07/20/cesium-and-milsymbol
- Esri military symbology styles: https://developers.arcgis.com/documentation/mapping-and-location-services/data-visualization/resources/military-symbology-styles/
- Deterministic browser capture (virtual clock): https://blog.replit.com/browsers-dont-want-to-be-cameras
- Headless Cesium capture discussion: https://community.cesium.com/t/how-to-run-cesium-on-server-side-and-capture-animation-frames/5435

---

## 10. Implementation status (2026-11-17)

Decisions made since v0.1, with the user's input: 2D first, symbols in the newest practical
standard (2525D/E), free/open components only with no keys, real places allowed, 1080p30 target.

- **Built:** web app (`npm run dev`) with AO presets or click-to-pick AO, zoom-driven echelon, a 2D/3D
  toggle (MapLibre terrain), and six looks. There's a scenario generator (5 templates × force
  packages × air options) with road-following ground movement from OpenFreeMap vector tiles
  (fallback: Overpass). Air patterns: racetrack CAP, strike ingress/egress, low-level helicopters
  along rivers, and UAV orbits. Riverine boats follow rivers. Also built: attrition with status
  changes, auto-generated control measures, a canvas HUD, PNG screenshots, frame-accurate WebCodecs
  MP4 recording, and MilX/NVG import.
- **Changes from v0.1:** FFmpeg/Playwright are no longer needed for export. Encoding happens
  in-browser with WebCodecs and MIT muxers, which avoids GPL FFmpeg. Road data comes from vector
  tiles instead of Overpass, which was too slow and unreliable. 3D comes first via MapLibre terrain;
  CesiumJS remains the option for globe-scale and 3D models.
- **Next:** headless CLI batch rendering, animating imported overlays, CesiumJS 3D with glTF models,
  camera keyframe editor, ODIN-layer JSON import, AMS-sheet georeferencing.
