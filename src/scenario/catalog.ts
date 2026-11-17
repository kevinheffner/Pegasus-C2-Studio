/** Areas of operations, force packages, and scenario templates offered in the UI. */
import type { LonLat } from './types';

export interface AOPreset {
  id: string;
  name: string;
  center: LonLat;
  zoom: number;
  /** Suggested axis of friendly attack (deg); generator may vary it. */
  axis: number;
}

export const AO_PRESETS: AOPreset[] = [
  { id: 'fulda', name: 'Fulda Gap, Germany', center: [9.83, 50.6], zoom: 11.7, axis: 90 },
  { id: 'suwalki', name: 'Suwałki Gap, Poland–Lithuania', center: [23.15, 54.2], zoom: 11.7, axis: 0 },
  { id: 'argonne', name: 'Meuse–Argonne, France', center: [4.95, 49.27], zoom: 11.7, axis: 0 },
  { id: 'bastogne', name: 'Ardennes – Bastogne, Belgium', center: [5.72, 50.0], zoom: 11.7, axis: 270 },
  { id: 'caen', name: 'Normandy – Caen, France', center: [-0.4, 49.15], zoom: 11.7, axis: 180 },
  { id: 'kasserine', name: 'Kasserine Pass, Tunisia', center: [8.78, 35.25], zoom: 11.7, axis: 300 },
  { id: 'cheorwon', name: 'Cheorwon Valley, Korea', center: [127.28, 38.2], zoom: 11.7, axis: 0 },
  { id: 'narva', name: 'Narva River, Estonia', center: [28.05, 59.33], zoom: 11.7, axis: 90 },
  { id: 'ntc', name: 'Fort Irwin NTC, California', center: [-116.6, 35.3], zoom: 11.7, axis: 90 },
];

export type Role = 'attack' | 'defend' | 'advance' | 'delay' | 'withdraw';

export interface Template {
  id: string;
  name: string;
  description: string;
  blue: Role;
  red: Role;
  durationMin: number;
}

export const TEMPLATES: Template[] = [
  {
    id: 'deliberate-attack',
    name: 'Deliberate attack (Blue attacks)',
    description: 'Red defends behind a fortified line; Blue attacks along main and supporting axes. Red breaks and withdraws.',
    blue: 'attack',
    red: 'defend',
    durationMin: 240,
  },
  {
    id: 'meeting',
    name: 'Meeting engagement',
    description: 'Both forces advance along roads and collide near the center of the AO.',
    blue: 'advance',
    red: 'advance',
    durationMin: 200,
  },
  {
    id: 'blue-delay',
    name: 'Red offensive / Blue delay',
    description: 'Red attacks; Blue trades space for time and falls back through successive phase lines.',
    blue: 'delay',
    red: 'attack',
    durationMin: 240,
  },
  {
    id: 'pursuit',
    name: 'Pursuit (Red withdraws)',
    description: 'Red withdraws along roads under pressure; Blue pursues.',
    blue: 'attack',
    red: 'withdraw',
    durationMin: 200,
  },
  {
    id: 'blue-defend',
    name: 'Blue defense',
    description: 'Blue holds battle positions; Red assaults and is attrited at the engagement area.',
    blue: 'defend',
    red: 'attack',
    durationMin: 240,
  },
];

export type Kind = 'armor' | 'mech' | 'motor' | 'inf' | 'recon' | 'arty' | 'ad' | 'eng' | 'hq';

/** 2525D land unit entity codes (symbol set 10), verified against mil-sym-ts MSLookup. */
export const ENTITY: Record<Kind, string> = {
  armor: '120500',
  mech: '121102',
  motor: '121104',
  inf: '121100',
  recon: '121300',
  arty: '130301',
  ad: '130100',
  eng: '140701',
  hq: '121102',
};

/** Cross-country speed (km/h) by kind, march speed on roads is ~1.6x. */
export const SPEED: Record<Kind, number> = {
  armor: 14,
  mech: 14,
  motor: 16,
  inf: 5,
  recon: 18,
  arty: 12,
  ad: 12,
  eng: 10,
  hq: 12,
};

/** Direct-fire combat power used by the simple attrition model. */
export const POWER: Record<Kind, number> = {
  armor: 1.0,
  mech: 0.8,
  motor: 0.6,
  inf: 0.5,
  recon: 0.4,
  arty: 0.3,
  ad: 0.2,
  eng: 0.3,
  hq: 0.1,
};

export interface ForcePackage {
  id: string;
  name: string;
  side: 'blue' | 'red';
  /** Battalion-level elements. */
  battalions: Kind[];
  /** Designation style */
  hqName: string;
}

export const FORCES: ForcePackage[] = [
  { id: 'abct', name: 'Armored Brigade', side: 'blue', battalions: ['armor', 'armor', 'mech', 'recon', 'arty', 'eng'], hqName: '1 BDE' },
  { id: 'mech-bde', name: 'Mechanized Infantry Brigade', side: 'blue', battalions: ['mech', 'mech', 'armor', 'recon', 'arty', 'eng'], hqName: '2 BDE' },
  { id: 'motor-bde', name: 'Motorized (Wheeled) Brigade', side: 'blue', battalions: ['motor', 'motor', 'motor', 'recon', 'arty'], hqName: '3 BDE' },
  { id: 'light-bde', name: 'Light Infantry Brigade', side: 'blue', battalions: ['inf', 'inf', 'inf', 'recon', 'arty'], hqName: '4 BDE' },
  { id: 'mr-bde', name: 'Motor Rifle Brigade', side: 'red', battalions: ['mech', 'mech', 'mech', 'armor', 'recon', 'arty', 'ad'], hqName: '27 MRB' },
  { id: 'tank-bde', name: 'Tank Brigade', side: 'red', battalions: ['armor', 'armor', 'armor', 'mech', 'recon', 'arty'], hqName: '4 TB' },
  { id: 'btg', name: 'Battalion Tactical Groups (×3)', side: 'red', battalions: ['mech', 'mech', 'mech', 'arty', 'ad'], hqName: 'BTG' },
  { id: 'red-light', name: 'Light Infantry Regiment', side: 'red', battalions: ['inf', 'inf', 'inf', 'recon', 'arty'], hqName: '112 IR' },
];

export type AirOption = 'none' | 'cap' | 'strike' | 'helo' | 'uav' | 'all';
export const AIR_OPTIONS: { id: AirOption; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'cap', name: 'Fighter CAP (racetrack orbit)' },
  { id: 'strike', name: 'Strike package (ingress/egress)' },
  { id: 'helo', name: 'Attack helicopters (low level)' },
  { id: 'uav', name: 'UAV orbit (ISR)' },
  { id: 'all', name: 'All of the above' },
];

export const PL_NAMES = ['IRON', 'COPPER', 'GOLD', 'SILVER', 'COBALT', 'NICKEL', 'ZINC', 'LEAD'];
export const OBJ_NAMES = ['DOG', 'CAT', 'WOLF', 'BEAR', 'HAWK', 'FOX', 'LION', 'ELK'];
export const RED_PL_NAMES = ['ROSE', 'TULIP', 'LILY', 'IRIS'];

/** Effective direct-fire range (km) by kind (tank guns/ATGMs ~3 km, IFV cannon/ATGM ~2.5 km, dismounts ~1 km). */
export const RANGE: Record<Kind, number> = {
  armor: 3.0,
  mech: 2.5,
  motor: 2.0,
  inf: 1.2,
  recon: 2.5,
  arty: 0,
  ad: 0,
  eng: 1.0,
  hq: 0.6,
};

/** Ground sensor range (km): how far a unit can detect enemy units in the open. */
export const SENSOR: Record<Kind, number> = {
  armor: 4,
  mech: 4,
  motor: 4,
  inf: 3,
  recon: 7,
  arty: 2,
  ad: 3,
  eng: 2.5,
  hq: 2,
};

/** Tunable battle-model parameters exposed in the UI. */
export interface BattleParams {
  /** multiplier on Blue combat power (training, equipment, morale) */
  blueQuality: number;
  /** global lethality multiplier */
  lethality: number;
  /** defender advantage in prepared positions (3 ≈ classic 3:1 rule) */
  defenderAdvantage: number;
  /** march / maneuver speed multiplier */
  tempo: number;
  /** minutes of artillery preparation before H-hour */
  prepMinutes: number;
  /** defender keeps a reserve that counterattacks a penetration */
  counterattack: boolean;
  /** scenario length (minutes) – 0 = template default */
  durationMin: number;
}

export const DEFAULT_PARAMS: BattleParams = {
  blueQuality: 1,
  lethality: 1,
  defenderAdvantage: 2.5,
  tempo: 1,
  prepMinutes: 20,
  counterattack: true,
  durationMin: 0,
};
