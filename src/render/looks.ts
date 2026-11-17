/**
 * Visual presets ("looks"). Every basemap here is free and needs no API key.
 *  - OpenTopoMap raster (CC-BY-SA, © OpenStreetMap contributors, SRTM)
 *  - OpenStreetMap standard raster (ODbL; light/interactive use per OSMF tile policy)
 *  - OpenFreeMap vector styles (free, no key; © OpenMapTiles, © OSM contributors)
 *  - EOX Sentinel-2 cloudless 2016 (CC BY 4.0)
 *  - AWS Terrain Tiles / Mapzen terrarium elevation (free public dataset)
 */
import type { StyleSpecification } from 'maplibre-gl';

export type HudKind = 'none' | 'c2-light' | 'c2-dark';

export interface Look {
  id: string;
  name: string;
  /** Either a URL to a MapLibre style or a function that builds one. */
  style: string | (() => StyleSpecification);
  hillshade: number; // 0 = off, else exaggeration
  contours: boolean;
  grid: boolean;
  gridColor: string;
  hud: HudKind;
  symbol: {
    size: number;
    colorMode: 'Light' | 'Medium' | 'Dark';
    infoColor: string;
    infoOutline: string;
    outlineColor?: string;
    outlineWidth?: number;
    fill: boolean;
  };
  /** colour used for "black" control-measure lines (friendly graphics) */
  graphicNeutral: string;
  graphicHalo: string;
  dark: boolean;
  attribution: string;
}

export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const FONT_BOLD = ['Noto Sans Bold'];
export const FONT_REG = ['Noto Sans Regular'];

const rasterStyle = (tiles: string[], attribution: string, maxzoom = 19, bg = '#ddd'): (() => StyleSpecification) => () => ({
  version: 8,
  glyphs: GLYPHS,
  sources: { base: { type: 'raster', tiles, tileSize: 256, maxzoom, attribution } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': bg } },
    { id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 0 } },
  ],
});

export const LOOKS: Look[] = [
  {
    id: 'topo',
    name: 'Topographic overlay (ArcGIS-style)',
    style: rasterStyle(
      ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
      '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
      17,
    ),
    hillshade: 0,
    contours: false,
    grid: false,
    gridColor: '#3060a0',
    hud: 'none',
    symbol: { size: 30, colorMode: 'Light', infoColor: '#000', infoOutline: '#ffffff', fill: true },
    graphicNeutral: '#000000',
    graphicHalo: '#ffffff',
    dark: false,
    attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
  },
  {
    id: 'vector-topo',
    name: 'Vector topo + hillshade + contours',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    hillshade: 0.35,
    contours: true,
    grid: false,
    gridColor: '#3060a0',
    hud: 'none',
    symbol: { size: 30, colorMode: 'Light', infoColor: '#000', infoOutline: '#ffffff', fill: true },
    graphicNeutral: '#000000',
    graphicHalo: '#ffffff',
    dark: false,
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
  },
  {
    id: 'c2-light',
    name: 'C2 workstation – light (OSM)',
    style: rasterStyle(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], '© OpenStreetMap contributors', 19),
    hillshade: 0,
    contours: false,
    grid: false,
    gridColor: '#304080',
    hud: 'c2-light',
    symbol: { size: 28, colorMode: 'Medium', infoColor: '#000', infoOutline: '#ffffff', fill: true },
    graphicNeutral: '#000000',
    graphicHalo: '#ffffff',
    dark: false,
    attribution: '© OpenStreetMap contributors',
  },
  {
    id: 'c2-dark',
    name: 'C2 console – dark + MGRS grid',
    style: 'https://tiles.openfreemap.org/styles/dark',
    hillshade: 0.25,
    contours: false,
    grid: true,
    gridColor: '#4fb3ff',
    hud: 'c2-dark',
    symbol: { size: 28, colorMode: 'Light', infoColor: '#e8f1ff', infoOutline: '#000000', fill: true },
    graphicNeutral: '#d8dee8',
    graphicHalo: '#000000',
    dark: true,
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
  },
  {
    id: 'c2-sat',
    name: 'C2 – satellite imagery + MGRS grid',
    style: rasterStyle(
      ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
      'Sentinel-2 cloudless 2016 by EOX IT Services GmbH (CC BY 4.0)',
      15,
      '#203020',
    ),
    hillshade: 0,
    contours: false,
    grid: true,
    gridColor: '#ffd84a',
    hud: 'c2-dark',
    symbol: { size: 28, colorMode: 'Light', infoColor: '#ffffff', infoOutline: '#000000', fill: true },
    graphicNeutral: '#ffffff',
    graphicHalo: '#000000',
    dark: true,
    attribution: 'Sentinel-2 cloudless 2016 by EOX (CC BY 4.0)',
  },
  {
    id: 'paper',
    name: 'Clean paper map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    hillshade: 0.2,
    contours: false,
    grid: false,
    gridColor: '#3060a0',
    hud: 'none',
    symbol: { size: 30, colorMode: 'Light', infoColor: '#000', infoOutline: '#ffffff', fill: true },
    graphicNeutral: '#000000',
    graphicHalo: '#ffffff',
    dark: false,
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
  },
];

export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const getLook = (id?: string) => LOOKS.find((l) => l.id === id) ?? LOOKS[0];
