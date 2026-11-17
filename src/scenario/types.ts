/**
 * Scenario format. All times are in MINUTES from scenario start.
 * Positions are [lon, lat] (WGS84).
 * SIDCs: 2525D/E 20-digit numeric preferred; 2525C 15-char letter codes are accepted for units.
 */
export type LonLat = [number, number];

export interface ScenarioMeta {
  name: string;
  /** ISO 8601 start date-time (UTC). Drives the DTG clock in C2 looks. */
  start: string;
  durationMin: number;
  /** Default look preset id (see render/looks.ts). */
  look?: string;
  /** Marking banner text shown on every frame. */
  banner?: string;
  /** Short title shown in the HUD. */
  title?: string;
  /** Friendly axis of attack (deg) – used by camera paths. */
  axis?: number;
}

export interface CameraKey {
  t: number;
  center: LonLat;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface Waypoint {
  t: number;
  pos: LonLat;
}

export interface UnitModifiers {
  /** T - unique designation */
  uniqueDesignation?: string;
  /** M - higher formation */
  higherFormation?: string;
  /** H - additional information */
  additionalInformation?: string;
  /** G - staff comments */
  staffComments?: string;
  /** F - reinforced/reduced (+, -, ±) */
  reinforcedReduced?: string;
  /** milsymbol direction (degrees). If "auto", derived from movement. */
  direction?: number | 'auto';
  /** Show the speed leader when moving. */
  speedLeader?: boolean;
}

export interface Unit {
  id: string;
  sidc: string;
  modifiers?: UnitModifiers;
  /** Timed waypoints. A single waypoint = stationary. */
  track: Waypoint[];
  /** Visible window (minutes); defaults to always. */
  appear?: number;
  disappear?: number;
  /** Symbol size override (px). */
  size?: number;
  /** Times/positions at which the OPPOSING side detected this unit (drives fog of war). */
  seen?: Waypoint[];
  /** true for aircraft (always tracked by air surveillance radar). */
  air?: boolean;
}

export interface GraphicModifiers {
  /** T - unique designation (e.g., "RED" for PL RED, "223" for OBJ) */
  T?: string;
  /** T1 - second unique designation */
  T1?: string;
  /** H - additional information */
  H?: string;
  /** W - date-time group */
  W?: string;
  /** W1 */
  W1?: string;
  /** AM - distance(s), comma separated metres */
  AM?: string;
  /** AN - azimuth(s), comma separated degrees */
  AN?: string;
}

export interface Graphic {
  id: string;
  /** 2525D/E 20-digit SIDC for control measures (symbol set 25). */
  sidc?: string;
  /** Plain geometry fallback when there is no SIDC (e.g., imported NVG shapes). */
  plain?: {
    kind: 'line' | 'polygon' | 'arrow' | 'circle';
    stroke?: string;
    fill?: string;
    width?: number;
    radiusM?: number;
    label?: string;
  };
  points: LonLat[];
  modifiers?: GraphicModifiers;
  /** Optional point keyframes for animated graphics (same point count). */
  keyframes?: { t: number; points: LonLat[] }[];
  appear?: number;
  disappear?: number;
  /** Line color override (#rrggbb). */
  color?: string;
}

export type ScenarioEvent =
  | { t: number; type: 'status'; unit: string; status: 'present' | 'damaged' | 'destroyed' | 'planned' }
  | { t: number; type: 'fire'; from: string; to: string; duration: number; kind?: 'direct' | 'indirect' | 'air' }
  | { t: number; type: 'strength'; unit: string; value: number }
  | { t: number; type: 'message'; text: string; duration?: number };

export interface Scenario {
  meta: ScenarioMeta;
  view: CameraKey;
  camera?: CameraKey[];
  units: Unit[];
  graphics: Graphic[];
  events?: ScenarioEvent[];
}
