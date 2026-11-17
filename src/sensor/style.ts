/** Imagery style for the EO/IR and SAR sensors: Sentinel-2 + terrain + crisp OSM detail (all keyless). */
import type maplibregl from 'maplibre-gl';
import { DEM_TILES } from '../render/looks';

export const SAT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    sat: { type: 'raster', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'], tileSize: 256, maxzoom: 15, attribution: 'Sentinel-2 cloudless 2016 by EOX (CC BY 4.0)' },
    dem: { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 },
    omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#203020' } },
    { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 0 } },
    // crisp OSM detail on top of the 10 m imagery: forest edges, water, buildings, roads
    { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#173322', 'fill-opacity': 0.35 } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#0d2a55' } },
    { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track'], true, false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], 'track', '#7d7462', '#8d8a85'], 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 0.6, 15, 2.5, 18, 14, 20, 50] } },
    { id: 'buildings', type: 'fill', source: 'omt', 'source-layer': 'building', paint: { 'fill-color': '#a8a29a' } },
  ],
};
