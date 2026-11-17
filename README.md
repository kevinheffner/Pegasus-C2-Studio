# Simulation Content Creator

Generates representative 2D/3D military C2 and simulation imagery: MIL-STD-2525D/E / APP-6 unit
symbols and tactical graphics on real maps, with animated engagements recorded as video.
Everything is free and open-source; no API keys are needed.

**Start:** double-click `start.bat`. It installs dependencies on first run, starts the local server
and opens http://localhost:5173 in your browser. Use Chrome or Edge, because video recording
needs their encoder. Or from a terminal:

```bash
npm install
npm run dev
```

## Start menu: three modules
| Module | What it produces |
|---|---|
| **2D / 3D COP Viewer** | **Pegasus C2 Studio**, a C2 workstation facsimile. A top bar with scenario library 📂, save 💾, 1/4-view layout, screenshot and record, and ⚙ settings. A left widget rail with MAP, LAYERS, INTEL (SPOTREP/BDA/SITREP built from simulated detections), ORBAT (strength bars), FIRES (fire missions) and CHAT. 1 or 4 views, either of the same AO (per-view style, 2D/3D, camera sequence, Blue-COP fog of war) or of 4 different AOs. |
| **3D Vehicle Simulations** | CesiumJS globe with keyless terrain and imagery, sun and shadows, and animated ocean. Generic procedural aircraft, armor, trucks and ships move along real roads, rivers and flight paths. Cameras: cinematic, chase, orbit, ground-observer flyby, overhead and free. Frame-perfect MP4. You can load your own .glb models. |
| **Military Sensor Simulations** | Representative (non-physics) EO/IR FLIR gimbal video, SAR image + GMTI, GMTI radar PPI, ESM/SIGINT spectrum waterfall + PDWs, and passive sonar BTR/LOFAR, all driven by the scenarios. Exports per-frame JSON/CSV metadata, MP4 video, and annotated datasets (PNG frames + JSON) to `out/exports/`. |
| **Instructor View** | Instructor operator station on one or two monitors (monitor 2 can pop out to a second screen). Monitor 1: master event list (scheduled, conditional and manual injects with Execute/Skip), ground-truth tactical map with threat rings and inject effects, instructor journal, freeze / step / time scale / snapshots. Monitor 2: trainee station repeaters (EO/IR, radar, ESM, COP), session KPIs, training objectives, session timeline. Screen-capture recording of either monitor or both. |

**Scenario packages** store the scenario settings, battle model, display options, default video settings, workspace layout and the generated battle. Seven built-in packages come in the library. Saved packages go to `scenarios/saved/*.scc.json`.

## Workflow (COP Viewer: all of these settings are in ⚙)
1. **Area of operations**: pick a preset AO (Fulda Gap, Suwałki Gap, Meuse–Argonne, Bastogne, Caen,
   Kasserine, Cheorwon, Narva, NTC) or click "Click on map to set AO center". Set the zoom and the
   Blue axis of attack. The AO is exactly what is visible in the 16:9 frame. Zoom sets the echelon:
   below 11.5 = brigades, 11.5–13.7 = battalions, above 13.7 = companies.
2. **View**: 2D or 3D (terrain + tilted camera), and one of six looks: topographic overlay, vector topo
   with contours, C2 light (OSM), C2 dark console with MGRS grid, satellite + grid, clean paper map.
3. **Scenario**: template (deliberate attack, meeting engagement, Red offensive/Blue delay, pursuit,
   Blue defense), Blue and Red force packages, air activity (fighter CAP racetrack, strike
   ingress/egress, low-level attack helicopters that follow rivers, UAV orbits), riverine boats,
   and a seed. **Generate** routes ground units over the real OSM road network. It then runs a
   time-stepped engagement (movement, contact, direct and indirect fire, attrition, breaking and
   withdrawing) and derives the graphics: LD, phase lines, boundaries, FLOTs, a fortified line,
   objectives, axes of advance, battle positions, engagement areas and an assembly area.
4. **Battle model** (section 3b): Blue combat power, lethality, defender advantage (prepared positions),
   tempo, artillery preparation length, scenario length, and whether the defender's reserve
   counterattacks. Change the values and press Generate. The same seed with the same parameters
   always gives the same battle.
5. **Display**: fog of war (Blue COP view: enemies are shown only where Blue sensors have detected
   them; stale contacts get a dashed frame), unit strength %, track-history trails.
6. **Camera path** (for playback and video): static, orbit, flyover along the axis of attack, follow
   the main effort, cinematic (overview → into the fight → pull back), or your own keyframes. For
   keyframes, frame the view, scrub the time, click "+ Keyframe", repeat, then select "My keyframes".
   Combine with 3D for moving-POV videos. **Steer the camera yourself**: mouse (drag = pan, right-drag or
   Ctrl+drag = rotate/tilt, wheel = zoom) or the CAMERA buttons in the bottom bar (not part of the output).
   **✈ Fly & capture** plays the battle in real time while you fly. Your flight is saved as keyframes and
   can then be rendered frame-perfectly.
7. Use **▶** / the timeline to play or scrub.
8. **Capture**: Screenshot (PNG) or **Record video**. Recording is frame-accurate: every frame waits
   for all map tiles before it is encoded. Output is H.264 MP4 at 1280×720 to 3840×2160 and
   24/30/60 fps. You can record a sub-range of the scenario (From/To T+). **Recording mode → Live** records
   in real time while you steer the camera; tiles may briefly load during fast moves. Marking
   (None / small corner tag / banner) is optional and off by default.
9. **Import / save**: MilX (`.milxly`, `.milxlyz` from map.army), NVG (`.nvg`) or saved scenario JSON.
   Samples are in `samples/imports/`.

## Battle model (how the dynamics work)
- **Phases**: assembly area → road march → attack positions → artillery preparation →
  synchronized **H-hour** at the LD → deployment off-road → fire and movement → consolidation.
  Recon leads and screens.
- **Defense in depth**: the security zone falls back, line units hold prepared battle positions,
  artillery sits in depth, and a reserve counterattacks a penetration (a counterattack arrow
  appears when the reserve is committed).
- **Meeting engagement**: march columns deploy on first contact. **Actions on contact**: any
  marching column that runs into the enemy deploys and attacks, then resumes the advance.
- **Attrition**: continuous and Lanchester-style. It depends on firer strength and readiness,
  weapon range, and target posture: march column ≫ deployed > hasty defense ≫ prepared position.
  Artillery suppresses its target. Prepared positions can only be engaged at short range unless
  previously spotted. Attackers halt in support-by-fire positions about 1 km out and assault only
  when the defender is worn down or suppressed.
- **Breakpoints**: a unit stalls at about 50 % strength, is combat ineffective and falls back at
  about 35 %, and is destroyed below 15 %. Attacks culminate and defenses break. Units below 70 %
  show the reduced "(-)" modifier and a yellow condition bar.
- **Fires**: preparation fires before H-hour, close support on detected targets, counter-battery
  fire, air strikes on priority targets (the reserve, artillery), and attack helicopters from a
  battle position (with enemy air defense engaging them).
- **Sensors**: ground units, recon, UAVs and helicopters detect enemies within sensor range, scaled
  by concealment. These sightings drive target acquisition and the fog-of-war view.

## Components and licences
| Purpose | Component | Licence |
|---|---|---|
| Unit symbols | milsymbol 3 | MIT |
| Tactical graphics (multipoint) | mil-sym-ts-web (US Army C5ISR renderer) | Apache-2.0 |
| Map engine (2D + 3D terrain) | MapLibre GL JS 5 | BSD-3 |
| Contours | maplibre-contour | BSD-3 |
| Vector tile decoding (road graph) | @mapbox/vector-tile, pbf | BSD-3 |
| Video muxing | mp4-muxer, webm-muxer (with browser WebCodecs) | MIT |
| Basemaps | OpenTopoMap (CC-BY-SA), OSM tiles (ODbL), OpenFreeMap (free), EOX Sentinel-2 cloudless 2016 (CC BY 4.0) | attribution is burned into exports |
| Elevation | AWS Terrain Tiles (terrarium) | free public dataset |

No GPL/AGPL code is used: FFmpeg isn't needed, and ODINv2 (AGPL) is a visual reference only.
The OSM standard tile server ("C2 light" look) is for light, interactive use. For heavy batch
rendering, use the OpenFreeMap-based looks.

## Layout
```
src/scenario/  types, catalog (AOs, forces, templates), generator (planning + engagement sim), sim (interpolation)
src/geo/       geodesy, MGRS/UTM, road/river networks + Dijkstra
src/render/    looks, symbols (milsymbol + mil-sym-ts), view2d (MapLibre), hud (canvas C2 chrome)
src/export/    deterministic WebCodecs recorder
src/import/    MilX / NVG importers (2525C → 2525D crosswalk for common control measures)
docs/DESIGN.md design document
```

An optional marking (corner tag or banner) can be added to frames. Unit designations are fictional.

## Sample overlay files
The MilX and NVG test files aren't included in the repository. To try the importers, download them into `samples/imports/`:
- map.army sample exercise: https://www.map.army/doc/milx/fictional-exercise.milxlyz
- NVG sample: https://github.com/spatialillusions/nvg/blob/master/dev/sample.xml
