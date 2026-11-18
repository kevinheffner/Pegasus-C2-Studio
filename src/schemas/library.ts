/**
 * Animated schema library: how C2 systems and simulations come together for training, rehearsal and analysis.
 * Original explanatory graphics; standard names and numbers as published by SISO, IEEE and NATO.
 */
import type { Schema, SNode } from './engine';

const REF = {
  c2sim: 'SISO-STD-019-2020 C2SIM; SISO-STD-020-2020 Land Operations Extension; NATO STANAG 4856 Ed. 1 (2023)',
  hla: 'IEEE 1516 High Level Architecture; NATO STANAG 4603',
  netn: 'NATO AMSP-04 / STANREC 4800 NETN Federation Architecture and FOM Design (NETN-FOM v4)',
  dseep: 'IEEE 1730 Distributed Simulation Engineering and Execution Process (DSEEP)',
  fmn: 'NATO Federated Mission Networking (FMN) concept and spiral specifications',
  msaas: 'NATO Modelling & Simulation as a Service (MSaaS)',
  lcim: 'Levels of Conceptual Interoperability Model (Tolk et al.)',
};

/** lay out n nodes on a circle (for cycles) */
function ring(ids: { id: string; label: string; sub?: string; icon?: SNode['icon'] }[], cx: number, cy: number, rx: number, ry: number, w: number, h: number, t0: number, dt: number, start = -Math.PI / 2): SNode[] {
  return ids.map((n, i) => {
    const a = start + (i / ids.length) * Math.PI * 2;
    return { ...n, x: cx + Math.cos(a) * rx - w / 2, y: cy + Math.sin(a) * ry - h / 2, w, h, c: i % 7, at: t0 + i * dt };
  });
}

// ---------------------------------------------------------------------------------------------
const c2simOverview: Schema = {
  id: 'c2sim-overview',
  category: 'C2SIM',
  title: 'C2SIM: connecting C2 systems and simulations',
  subtitle: 'Command & Control to Simulation interoperation, from initialization to orders and reports',
  duration: 38,
  description: 'Overview of the C2SIM architecture: national C2 systems and simulations exchange standard Initialization, Order and Report messages through a C2SIM server.',
  refs: [REF.c2sim],
  nodes: [
    { id: 'gc2', shape: 'group', x: 70, y: 190, w: 560, h: 720, label: 'Command & control systems', c: 0, at: 0.5 },
    { id: 'c2a', x: 110, y: 250, w: 480, h: 150, label: 'National C2 system A', sub: 'Brigade HQ · orders & COP', icon: 'c2', c: 0, at: 1 },
    { id: 'c2b', x: 110, y: 450, w: 480, h: 150, label: 'National C2 system B', sub: 'Coalition battalion HQ', icon: 'c2', c: 0, at: 1.5 },
    { id: 'exc', x: 110, y: 650, w: 480, h: 150, label: 'Exercise control', sub: 'scenario, ORBAT & injects', icon: 'people', c: 4, at: 2 },
    { id: 'srv', x: 760, y: 420, w: 400, h: 220, label: 'C2SIM server', sub: 'mediates · validates · distributes', icon: 'server', c: 1, at: 3 },
    { id: 'gsim', shape: 'group', x: 1290, y: 190, w: 560, h: 720, label: 'Simulation systems', c: 2, at: 0.5 },
    { id: 's1', x: 1330, y: 250, w: 480, h: 150, label: 'Land simulation', sub: 'constructive · computer generated forces', icon: 'tank', c: 2, at: 3.6 },
    { id: 's2', x: 1330, y: 450, w: 480, h: 150, label: 'Air simulation', sub: 'air tasking & air defence', icon: 'plane', c: 2, at: 4 },
    { id: 's3', x: 1330, y: 650, w: 480, h: 150, label: 'Logistics & medical sim', sub: 'supply, maintenance, casualties', icon: 'gear', c: 2, at: 4.4 },
  ],
  links: [
    { a: 'c2a', b: 'srv', at: 3.4, two: true, flows: [{ label: 'ORDER', c: 0, t0: 13, every: 3, until: 21 }, { label: 'REPORT', c: 2, dir: -1, t0: 22, every: 2.6, until: 34 }] },
    { a: 'c2b', b: 'srv', at: 3.5, two: true, flows: [{ label: 'ORDER', c: 0, t0: 14.5, every: 3.5, until: 21 }, { label: 'REPORT', c: 2, dir: -1, t0: 23, every: 2.8, until: 34 }] },
    { a: 'exc', b: 'srv', at: 3.6, two: true, flows: [{ label: 'INIT', c: 4, t0: 6.5, every: 1.6, until: 10 }] },
    { a: 'srv', b: 's1', at: 4.8, two: true, flows: [{ label: 'INIT', c: 4, t0: 8.2, every: 1.6, until: 11.5 }, { label: 'ORDER', c: 0, t0: 14.7, every: 3, until: 22 }, { label: 'REPORT', c: 2, dir: -1, t0: 20.5, every: 2.6, until: 32 }] },
    { a: 'srv', b: 's2', at: 5, two: true, flows: [{ label: 'INIT', c: 4, t0: 8.6, every: 1.6, until: 11.5 }, { label: 'ORDER', c: 0, t0: 16.2, every: 3.5, until: 22 }, { label: 'REPORT', c: 2, dir: -1, t0: 21.3, every: 2.8, until: 32 }] },
    { a: 'srv', b: 's3', at: 5.2, two: true, flows: [{ label: 'INIT', c: 4, t0: 9, every: 1.6, until: 11.5 }, { label: 'REPORT', c: 2, dir: -1, t0: 22, every: 3, until: 32 }] },
  ],
  highlights: [
    { t0: 6, t1: 12, ids: ['exc', 'srv'] },
    { t0: 13, t1: 20, ids: ['c2a', 'c2b'] },
    { t0: 20.5, t1: 28, ids: ['s1', 's2', 's3'] },
    { t0: 30, t1: 38, ids: ['srv'] },
  ],
  badges: [
    { x: 960, y: 690, text: 'SISO-STD-019-2020 · C2SIM', c: 1, at: 30 },
    { x: 960, y: 738, text: 'SISO-STD-020-2020 · Land Operations Extension', c: 1, at: 31 },
    { x: 960, y: 786, text: 'NATO STANAG 4856', c: 1, at: 32 },
    { x: 960, y: 360, text: 'XML messages over standard transports', c: 5, at: 5.5 },
  ],
  captions: [
    { t: 0.5, text: 'C2SIM lets real command-and-control systems work directly with simulations, without a custom bridge for every pair.' },
    { t: 6, text: '1 · Initialization: exercise control shares the starting picture (units, ORBAT, positions) with every participating system.' },
    { t: 13, text: '2 · Orders: staff task units in their own C2 system; the server delivers standard C2SIM orders to the simulation owning those units.' },
    { t: 20.5, text: '3 · Reports: simulations return position, status and observation reports that update every C2 system’s picture.' },
    { t: 29, text: 'One coalition-wide data model, defined as an ontology and exchanged as XML: SISO-STD-019, adopted by NATO as STANAG 4856.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const stY = 400, stH = 120;
const c2simStates: Schema = {
  id: 'c2sim-states',
  category: 'C2SIM',
  title: 'A C2SIM session, step by step',
  subtitle: 'The shared session states a C2SIM server moves through, and which messages flow in each',
  duration: 34,
  description: 'Session state machine of a C2SIM coalition: uninitialized, initializing, initialized, running and paused, with the messages allowed in each state.',
  refs: [REF.c2sim, 'C2SIM reference server (GMU C4I & Cyber Center, TNO)'],
  nodes: [
    { id: 'u', shape: 'state', x: 80, y: stY, w: 300, h: stH, label: 'UNINITIALIZED', c: 6, at: 1 },
    { id: 'ing', shape: 'state', x: 450, y: stY, w: 300, h: stH, label: 'INITIALIZING', c: 4, at: 2 },
    { id: 'ed', shape: 'state', x: 820, y: stY, w: 300, h: stH, label: 'INITIALIZED', c: 5, at: 3 },
    { id: 'run', shape: 'state', x: 1190, y: stY, w: 300, h: stH, label: 'RUNNING', c: 2, at: 4 },
    { id: 'p', shape: 'state', x: 1190, y: 690, w: 300, h: stH, label: 'PAUSED', c: 1, at: 5 },
    { id: 'm1', shape: 'layer', x: 450, y: 220, w: 300, h: 90, label: 'Initialization messages', sub: 'ORBAT · units · positions', c: 4, at: 9 },
    { id: 'm2', shape: 'layer', x: 1190, y: 220, w: 300, h: 90, label: 'Orders & reports', sub: 'tasks ↔ status / observations', c: 2, at: 17 },
    { id: 'clk', x: 1550, y: 400, w: 320, h: 120, label: 'Simulation clock', sub: 'advances only while running', icon: 'clock', c: 2, at: 18 },
  ],
  links: [
    { a: 'u', b: 'ing', at: 6, label: 'initialize', c: 4 },
    { a: 'ing', b: 'ed', at: 11, label: 'share', c: 5 },
    { a: 'ed', b: 'run', at: 14, label: 'start', c: 2 },
    { a: 'run', b: 'p', at: 21, label: 'pause', c: 1, bend: -60 },
    { a: 'p', b: 'run', at: 23, label: 'resume', c: 2, bend: -60 },
    { a: 'p', b: 'u', at: 26, label: 'stop · reset', c: 6, bend: -120, dashed: true },
    { a: 'm1', b: 'ing', at: 9.5, dashed: true, none: true },
    { a: 'm2', b: 'run', at: 17.5, dashed: true, none: true },
    { a: 'run', b: 'clk', at: 18.5, dashed: true },
  ],
  highlights: [
    { t0: 1, t1: 6, ids: ['u'] },
    { t0: 6, t1: 11, ids: ['ing', 'm1'] },
    { t0: 11, t1: 14, ids: ['ed'] },
    { t0: 14, t1: 21, ids: ['run', 'm2', 'clk'] },
    { t0: 21, t1: 23.5, ids: ['p'] },
    { t0: 23.5, t1: 26, ids: ['run'] },
    { t0: 26, t1: 30, ids: ['p', 'u'] },
  ],
  captions: [
    { t: 0.5, text: 'Every system in the coalition follows the same session states, so C2 systems and simulations stay in step.' },
    { t: 6, text: 'Initializing: exercise control loads the scenario, the ORBAT, unit positions and control measures.' },
    { t: 11, text: 'Initialized: the initialization is shared with all participants, so everyone starts from the same picture.' },
    { t: 14, text: 'Running: staff issue orders, simulations execute them and report back as the simulation clock advances.' },
    { t: 21, text: 'Paused and resumed by exercise control, for example for a hot wash-up or to let a training audience catch up.' },
    { t: 26, text: 'Stop and reset return the coalition to its starting point, ready for the next session or a new scenario.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const c2simOntology: Schema = {
  id: 'c2sim-ontology',
  category: 'C2SIM',
  title: 'From ontology to messages',
  subtitle: 'How the C2SIM data model is defined, extended and turned into validated XML messages',
  duration: 32,
  description: 'C2SIM ontology layers (Core, SMX, LOX, extensions) and the pipeline from RDF/XML ontology via XSLT to an XML schema that validates Initialization, Order and Report messages.',
  refs: [REF.c2sim],
  nodes: [
    { id: 'ext', shape: 'layer', x: 90, y: 260, w: 520, h: 110, label: 'National / project extensions', sub: 'domain-specific additions', c: 4, at: 6 },
    { id: 'lox', shape: 'layer', x: 90, y: 400, w: 520, h: 110, label: 'Land Operations Extension (LOX)', sub: 'SISO-STD-020', c: 2, at: 4 },
    { id: 'smx', shape: 'layer', x: 90, y: 540, w: 520, h: 110, label: 'Standard Military Extension (SMX)', sub: 'common military concepts', c: 5, at: 2.5 },
    { id: 'core', shape: 'layer', x: 90, y: 680, w: 520, h: 110, label: 'Core ontology', sub: 'entities, actions, events, locations', c: 0, at: 1 },
    { id: 'rdf', shape: 'box', x: 740, y: 290, w: 330, h: 120, label: 'Ontology file', sub: 'RDF / XML', icon: 'doc', c: 0, at: 9 },
    { id: 'xslt', shape: 'box', x: 740, y: 470, w: 330, h: 120, label: 'XSLT transform', sub: 'automated generation', icon: 'gear', c: 1, at: 11 },
    { id: 'xsd', shape: 'box', x: 740, y: 650, w: 330, h: 120, label: 'XML Schema (XSD)', sub: 'message grammar', icon: 'doc', c: 5, at: 13 },
    { id: 'gen', x: 1200, y: 650, w: 330, h: 120, label: 'Code generation', sub: 'bindings for C2 & sims', icon: 'cube', c: 4, at: 16 },
    { id: 'val', x: 1200, y: 470, w: 330, h: 120, label: 'Validation', sub: 'every message checked', icon: 'shield', c: 2, at: 17 },
    { id: 'i', shape: 'pill', x: 1600, y: 300, w: 250, h: 70, label: 'Initialization', c: 4, at: 21 },
    { id: 'o', shape: 'pill', x: 1600, y: 400, w: 250, h: 70, label: 'Order', c: 0, at: 22 },
    { id: 'r', shape: 'pill', x: 1600, y: 500, w: 250, h: 70, label: 'Report', c: 2, at: 23 },
    { id: 'sys', shape: 'pill', x: 1600, y: 600, w: 250, h: 70, label: 'System commands', c: 6, at: 24 },
  ],
  links: [
    { a: 'ext', b: 'rdf', at: 9.5, dashed: true },
    { a: 'rdf', b: 'xslt', at: 11, flows: [{ label: 'OWL', c: 0, t0: 11.5, every: 2.4, until: 30 }] },
    { a: 'xslt', b: 'xsd', at: 13, flows: [{ label: 'XSD', c: 5, t0: 13.5, every: 2.4, until: 30 }] },
    { a: 'xsd', b: 'gen', at: 16 },
    { a: 'xsd', b: 'val', at: 17 },
    { a: 'val', b: 'i', at: 21, flows: [{ label: 'XML', c: 4, t0: 21.5, every: 3, until: 31 }] },
    { a: 'val', b: 'o', at: 22, flows: [{ label: 'XML', c: 0, t0: 22.5, every: 3, until: 31 }] },
    { a: 'val', b: 'r', at: 23, flows: [{ label: 'XML', c: 2, t0: 23.5, every: 3, until: 31 }] },
    { a: 'val', b: 'sys', at: 24 },
  ],
  highlights: [
    { t0: 1, t1: 8, ids: ['core', 'smx', 'lox', 'ext'] },
    { t0: 9, t1: 15, ids: ['rdf', 'xslt', 'xsd'] },
    { t0: 16, t1: 20, ids: ['gen', 'val'] },
    { t0: 21, t1: 28, ids: ['i', 'o', 'r', 'sys'] },
  ],
  captions: [
    { t: 0.5, text: 'C2SIM is built on an ontology: a formal model of military concepts that every system interprets the same way.' },
    { t: 4, text: 'A small core is extended by a Standard Military Extension, the Land Operations Extension, and national or project extensions.' },
    { t: 9, text: 'The ontology is stored as RDF/XML and transformed automatically, with XSLT, into an XML Schema.' },
    { t: 16, text: 'The schema drives code generation for C2 systems and simulations, and validates every message exchanged.' },
    { t: 21, text: 'The result: well-defined Initialization, Order, Report and system-command messages that mean the same thing everywhere.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const fed = (id: string, x: number, y: number, label: string, sub: string, icon: SNode['icon'], c: number, at: number): SNode => ({ id, x, y, w: 380, h: 130, label, sub, icon, c, at });
const hlaFederation: Schema = {
  id: 'hla-federation',
  category: 'HLA & NETN',
  title: 'An HLA federation',
  subtitle: 'Simulations, C2 gateways and tools joined through a Run-Time Infrastructure (RTI)',
  duration: 36,
  description: 'High Level Architecture federation: federates publish and subscribe through the RTI using a shared Federation Object Model (RPR-FOM + NETN modules) under a federation agreement.',
  refs: [REF.hla, REF.netn],
  nodes: [
    fed('gw', 90, 210, 'C2 gateway', 'C2SIM ↔ HLA', 'c2', 0, 3),
    fed('cgf', 520, 210, 'Constructive simulation', 'computer generated forces', 'tank', 2, 3.4),
    fed('vir', 950, 210, 'Virtual simulators', 'flight & vehicle crews', 'plane', 5, 3.8),
    fed('live', 1380, 210, 'Live instrumentation', 'range & tracking data', 'radio', 3, 4.2),
    { id: 'rti', shape: 'pill', x: 90, y: 470, w: 1670, h: 110, label: 'Run-Time Infrastructure (RTI)', sub: 'federation · declaration · object · ownership · time · data distribution management', c: 1, at: 1, size: 30 },
    fed('exc', 90, 680, 'Exercise control', 'start, pause, injects', 'people', 4, 4.6),
    fed('log', 520, 680, 'Data logger & AAR', 'record, replay, analyse', 'chart', 6, 5),
    fed('view', 950, 680, '3D viewer', 'stealth / observer view', 'eye', 5, 5.4),
    { id: 'fom', shape: 'box', x: 1380, y: 650, w: 380, h: 190, label: 'Federation Object Model', sub: 'RPR-FOM + NETN modules · the shared vocabulary', icon: 'book', c: 1, at: 16 },
  ],
  links: [
    { a: 'gw', b: 'rti', at: 5.8, two: true, flows: [{ label: 'tasks', c: 0, t0: 24, every: 4, until: 34 }] },
    { a: 'cgf', b: 'rti', at: 5.9, two: true, flows: [{ label: 'entity update', c: 2, t0: 9, every: 2.5, until: 34 }] },
    { a: 'vir', b: 'rti', at: 6, two: true, flows: [{ label: 'fire', c: 3, t0: 11, every: 4, until: 34 }] },
    { a: 'live', b: 'rti', at: 6.1, two: true, flows: [{ label: 'position', c: 3, t0: 10, every: 3, until: 34 }] },
    { a: 'rti', b: 'exc', at: 6.2, two: true, flows: [{ label: 'start / pause', c: 4, dir: -1, t0: 20, every: 6, until: 34 }] },
    { a: 'rti', b: 'log', at: 6.3, flows: [{ c: 6, t0: 9.5, every: 0.8, until: 34 }] },
    { a: 'rti', b: 'view', at: 6.4, flows: [{ c: 5, t0: 10, every: 1.1, until: 34 }] },
    { a: 'fom', b: 'rti', at: 16.5, dashed: true, label: 'loaded at join' },
  ],
  highlights: [
    { t0: 1, t1: 3, ids: ['rti'] },
    { t0: 8.5, t1: 15, ids: ['cgf', 'vir', 'live', 'log', 'view'] },
    { t0: 16, t1: 22, ids: ['fom'] },
    { t0: 23, t1: 30, ids: ['gw', 'exc'] },
  ],
  badges: [
    { x: 1570, y: 880, text: 'IEEE 1516 · NATO STANAG 4603', c: 1, at: 29 },
    { x: 1570, y: 928, text: 'NETN-FOM · AMSP-04 / STANREC 4800', c: 1, at: 30 },
  ],
  captions: [
    { t: 0.5, text: 'The High Level Architecture joins independent simulations, called federates, into one federation through a Run-Time Infrastructure.' },
    { t: 3, text: 'Each federate keeps its own models: constructive forces, crewed simulators, live range data, viewers and loggers.' },
    { t: 8.5, text: 'Federates publish what they own and subscribe to what they need; the RTI routes the updates and interactions.' },
    { t: 16, text: 'A shared Federation Object Model (the RPR-FOM extended with NATO NETN modules) defines what can be exchanged.' },
    { t: 23, text: 'C2 gateways and exercise control join the same federation, linking the staff’s real C2 systems to the synthetic battle.' },
    { t: 29, text: 'Standardized as IEEE 1516 and NATO STANAG 4603, with the NETN reference federation agreement (AMSP-04).' },
  ],
};

// ---------------------------------------------------------------------------------------------
const NETN: [string, string, number][] = [
  ['NETN-BASE', 'common datatypes for all modules', 0],
  ['NETN-ENTITY', 'physical & aggregate entities', 2],
  ['NETN-ORG', 'organizations & command structure', 4],
  ['NETN-ETR', 'entity tasking & reports', 0],
  ['NETN-SMC', 'simulation management & control', 1],
  ['NETN-TMR', 'transfer of modelling responsibility', 5],
  ['NETN-MRM', 'multi-resolution modelling', 5],
  ['NETN-LOG', 'logistics: supplies & equipment', 1],
  ['NETN-COM', 'communication network status', 6],
  ['NETN-METOC', 'weather & ocean conditions', 2],
  ['NETN-SE', 'synthetic environment objects', 2],
  ['NETN-CBRN', 'CBRN release, detection & effects', 3],
  ['NETN-DIM', 'disasters: flooding, wildfire', 3],
  ['NETN-AIS', 'maritime vessel tracking (AIS)', 5],
];
const netnNodes: SNode[] = NETN.map(([label, sub, c], i) => {
  const a = -Math.PI / 2 + ((i + 0.5) / NETN.length) * Math.PI * 2;
  return { id: 'n' + i, x: 960 + Math.cos(a) * 730 - 150, y: 560 + Math.sin(a) * 320 - 44, w: 300, h: 88, label, sub, c, at: 4 + i * 1.6, size: 21 };
});
const netnFom: Schema = {
  id: 'netn-fom',
  category: 'HLA & NETN',
  title: 'The NETN Federation Object Model',
  subtitle: 'NATO Education and Training Network modules extending the RPR-FOM',
  duration: 34,
  description: 'The 14 NETN-FOM v4 modules (AMSP-04) built around the SISO RPR-FOM, each adding a standard interface for a domain such as tasking, logistics, CBRN or weather.',
  refs: [REF.netn, 'SISO-STD-001 Real-time Platform Reference FOM (RPR-FOM)'],
  nodes: [{ id: 'rpr', shape: 'circle', x: 810, y: 410, w: 300, h: 300, label: 'RPR-FOM', sub: 'SISO-STD-001 base', icon: 'book', c: 1, at: 1, size: 32 }, ...netnNodes],
  links: netnNodes.map((n) => ({ a: 'rpr', b: n.id, at: (n.at ?? 0) + 0.2, none: true, dashed: true })),
  highlights: netnNodes.map((n) => ({ t0: n.at ?? 0, t1: (n.at ?? 0) + 1.6, ids: [n.id] })).concat([{ t0: 28, t1: 34, ids: ['rpr'] }]),
  captions: [
    { t: 0.5, text: 'NATO’s reference federation agreement builds on the SISO Real-time Platform Reference FOM (RPR-FOM).' },
    { t: 4, text: 'NETN modules add standard interfaces for what training federations need beyond platforms: organizations, tasking and control.' },
    { t: 14, text: 'Others cover sustainment and the environment: logistics, communication networks, weather and synthetic-environment objects.' },
    { t: 22, text: 'Specialist modules represent CBRN effects, disasters such as floods and wildfires, and maritime AIS traffic.' },
    { t: 28, text: 'Together, the 14 modules of NETN-FOM v4 form NATO AMSP-04 (STANREC 4800), reused from exercise to exercise.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const dseep: Schema = {
  id: 'dseep',
  category: 'Process',
  title: 'Building a federation: the DSEEP',
  subtitle: 'IEEE 1730 Distributed Simulation Engineering and Execution Process',
  duration: 34,
  description: 'The seven DSEEP steps from objectives to analysis, with federation agreements captured along the way.',
  refs: [REF.dseep, 'SISO Federation Engineering Agreements Template (FEAT)'],
  nodes: [
    ...ring(
      [
        { id: 'd1', label: '1 · Define objectives', sub: 'what must the event achieve?', icon: 'target' },
        { id: 'd2', label: '2 · Conceptual analysis', sub: 'scenario & requirements', icon: 'book' },
        { id: 'd3', label: '3 · Design', sub: 'select members, allocate models', icon: 'net' },
        { id: 'd4', label: '4 · Develop', sub: 'FOM, agreements, adapters', icon: 'gear' },
        { id: 'd5', label: '5 · Integrate & test', sub: 'connectivity, interoperability', icon: 'shield' },
        { id: 'd6', label: '6 · Execute', sub: 'run the event, collect data', icon: 'clock' },
        { id: 'd7', label: '7 · Analyse & evaluate', sub: 'results & lessons', icon: 'chart' },
      ],
      960, 555, 660, 290, 400, 120, 2, 3,
    ),
    { id: 'fa', shape: 'circle', x: 800, y: 405, w: 320, h: 300, label: 'Federation agreements', sub: 'captured with FEAT', icon: 'doc', c: 1, at: 24, size: 26 },
  ],
  links: [
    ...['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((id, i, a) => ({ a: id, b: a[(i + 1) % a.length], at: 2.5 + i * 3 + (i === 6 ? 2 : 0), bend: 70, c: i === 6 ? 0 : undefined, dashed: i === 6, label: i === 6 ? 'lessons feed the next event' : undefined, flows: [{ c: 0, t0: 25 + i * 0.9, every: 6.3, until: 34, dur: 0.9 }] })),
    { a: 'd3', b: 'fa', at: 24.5, dashed: true, none: true },
    { a: 'd4', b: 'fa', at: 24.5, dashed: true, none: true },
  ],
  highlights: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((id, i) => ({ t0: 2 + i * 3, t1: 5 + i * 3, ids: [id] })).concat([{ t0: 24, t1: 28, ids: ['fa', 'd3', 'd4'] }]),
  captions: [
    { t: 0.5, text: 'Distributed training events are engineered, not improvised: IEEE 1730 describes seven steps.' },
    { t: 2, text: 'Start from the training or analysis objectives, then analyse the scenario and the conceptual requirements.' },
    { t: 8, text: 'Design and develop the federation: choose the simulations, agree the object model and build adapters.' },
    { t: 14, text: 'Integrate and test until every system interoperates, then execute the event and collect the data.' },
    { t: 20, text: 'Analyse and evaluate the results, and feed the lessons into the next iteration.' },
    { t: 24, text: 'Decisions made along the way are recorded as federation agreements, for example using SISO FEAT.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const cax: Schema = {
  id: 'cax-staff-training',
  category: 'Training',
  title: 'Computer-assisted command post exercise',
  subtitle: 'Training a headquarters staff on its real C2 systems, with simulation running the battle',
  duration: 40,
  description: 'Structure of a CAX: the training audience works on real C2 systems; response cells and OPFOR drive the simulation; exercise control injects MSEL events; observers feed the after-action review.',
  refs: [REF.c2sim, REF.hla, 'NATO Bi-SC collective training & exercise directive (CAX organization)'],
  nodes: [
    { id: 'ta', shape: 'group', x: 70, y: 200, w: 520, h: 520, label: 'Training audience', c: 0, at: 0.5 },
    { id: 'hq', x: 110, y: 260, w: 440, h: 140, label: 'Headquarters staff', sub: 'plans, decides, issues orders', icon: 'people', c: 0, at: 1 },
    { id: 'c2', x: 110, y: 450, w: 440, h: 140, label: 'Real C2 systems', sub: 'the tools they use on operations', icon: 'c2', c: 0, at: 1.6 },
    { id: 'ic', x: 760, y: 450, w: 400, h: 140, label: 'C2–simulation link', sub: 'C2SIM / gateways', icon: 'net', c: 1, at: 4 },
    { id: 'sim', x: 1330, y: 450, w: 520, h: 140, label: 'Simulation', sub: 'constructive battle: movement, combat, logistics', icon: 'sim', c: 2, at: 3 },
    { id: 'lc', x: 1330, y: 230, w: 250, h: 130, label: 'Response cells', sub: 'subordinate units (LOCON)', icon: 'radio', c: 5, at: 9 },
    { id: 'op', x: 1600, y: 230, w: 250, h: 130, label: 'OPFOR cell', sub: 'thinking enemy', icon: 'flag', c: 3, at: 10 },
    { id: 'hi', x: 760, y: 230, w: 400, h: 130, label: 'Higher control (HICON)', sub: 'superior HQ, neighbours', icon: 'people', c: 5, at: 11 },
    { id: 'ex', x: 760, y: 700, w: 400, h: 140, label: 'Exercise control', sub: 'MSEL injects, pace & realism', icon: 'clock', c: 4, at: 15 },
    { id: 'ob', x: 110, y: 760, w: 440, h: 130, label: 'Observer / trainers', sub: 'capture performance', icon: 'eye', c: 6, at: 20 },
    { id: 'aar', x: 1330, y: 720, w: 520, h: 140, label: 'After-action review', sub: 'replay, findings, lessons identified', icon: 'chart', c: 6, at: 25 },
  ],
  links: [
    { a: 'hq', b: 'c2', at: 2, two: true },
    { a: 'c2', b: 'ic', at: 4.5, two: true, flows: [{ label: 'orders', c: 0, t0: 6, every: 4, until: 38 }, { label: 'reports', c: 2, dir: -1, t0: 8, every: 4, until: 38 }] },
    { a: 'ic', b: 'sim', at: 5, two: true, flows: [{ label: 'orders', c: 0, t0: 7.4, every: 4, until: 38 }, { label: 'reports', c: 2, dir: -1, t0: 6.5, every: 4, until: 38 }] },
    { a: 'lc', b: 'sim', at: 9.5, two: true, flows: [{ c: 5, t0: 10, every: 2.5, until: 38 }] },
    { a: 'op', b: 'sim', at: 10.5, two: true, flows: [{ c: 3, t0: 11, every: 2.8, until: 38 }] },
    { a: 'hi', b: 'c2', at: 11.5, label: 'directives', bend: 40, flows: [{ c: 5, t0: 12.5, every: 6, until: 38 }] },
    { a: 'ex', b: 'sim', at: 15.5, label: 'injects', flows: [{ label: 'MSEL', c: 4, t0: 16, every: 5, until: 38 }] },
    { a: 'ob', b: 'hq', at: 20.5, dashed: true, bend: 80 },
    { a: 'ob', b: 'aar', at: 21, dashed: true, bend: -90, flows: [{ label: 'observations', c: 6, t0: 22, every: 5, until: 38 }] },
    { a: 'sim', b: 'aar', at: 25.5, label: 'recorded data', flows: [{ c: 6, t0: 26, every: 1.5, until: 38 }] },
  ],
  highlights: [
    { t0: 1, t1: 4, ids: ['hq', 'c2'] },
    { t0: 4, t1: 9, ids: ['ic', 'sim'] },
    { t0: 9, t1: 14, ids: ['lc', 'op', 'hi'] },
    { t0: 15, t1: 20, ids: ['ex'] },
    { t0: 20, t1: 25, ids: ['ob'] },
    { t0: 25, t1: 32, ids: ['aar'] },
  ],
  captions: [
    { t: 0.5, text: 'In a computer-assisted exercise, the headquarters staff trains on the same C2 systems it uses on operations.' },
    { t: 4, text: 'Their orders flow into a simulation that fights the battle, and the simulation’s reports flow back into their C2 systems.' },
    { t: 9, text: 'Response cells play subordinate units, an OPFOR cell plays a thinking enemy, and higher control plays superiors and neighbours.' },
    { t: 15, text: 'Exercise control injects events from the master scenario events list (MSEL) to drive the training objectives.' },
    { t: 20, text: 'Observer/trainers capture how the staff performs: decisions, timelines, battle rhythm and reporting.' },
    { t: 25, text: 'Recorded simulation data and observations come together in the after-action review, where the staff learns.' },
    { t: 33, text: 'Standards such as C2SIM and HLA make this set-up reusable across nations, exercises and systems.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const rehearsal: Schema = {
  id: 'mission-rehearsal',
  category: 'Training',
  title: 'Mission planning & rehearsal with simulation',
  subtitle: 'Using the same C2 data to test courses of action before execution',
  duration: 34,
  description: 'Mission rehearsal loop: the plan in the C2 system is sent to simulation, courses of action are wargamed faster than real time, analysed, refined and rehearsed before execution.',
  refs: [REF.c2sim, REF.msaas],
  nodes: [
    ...ring(
      [
        { id: 'r1', label: 'Plan in C2', sub: 'orders, graphics, ORBAT', icon: 'c2' },
        { id: 'r2', label: 'Send to simulation', sub: 'C2SIM initialization & orders', icon: 'net' },
        { id: 'r3', label: 'Wargame courses of action', sub: 'faster than real time, many runs', icon: 'sim' },
        { id: 'r4', label: 'Analyse outcomes', sub: 'risk, timings, losses, logistics', icon: 'chart' },
        { id: 'r5', label: 'Refine the plan', sub: 'adjust tasks & synchronisation', icon: 'gear' },
        { id: 'r6', label: 'Rehearse', sub: 'commanders & staff walk through', icon: 'people' },
      ],
      960, 560, 560, 270, 400, 120, 2, 3,
    ),
    { id: 'go', shape: 'circle', x: 830, y: 450, w: 260, h: 230, label: 'Execute', sub: 'better prepared', icon: 'flag', c: 2, at: 24, size: 30 },
  ],
  links: [
    ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id, i, a) => ({ a: id, b: a[(i + 1) % a.length], at: 2.5 + i * 3, bend: 60, flows: [{ c: i % 7, t0: 4 + i * 3, every: 7.2, until: 34, dur: 1.2 }] })),
    { a: 'r6', b: 'go', at: 24.5, c: 2 },
  ],
  highlights: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id, i) => ({ t0: 2 + i * 3, t1: 5 + i * 3, ids: [id] })).concat([{ t0: 24, t1: 34, ids: ['go'] }]),
  badges: [{ x: 960, y: 920, text: 'Same data · same systems · less translation effort', c: 0, at: 28 }],
  captions: [
    { t: 0.5, text: 'Simulation is not only for training: it helps staffs test a plan before they execute it.' },
    { t: 2, text: 'The plan built in the C2 system (orders, control measures, task organisation) is sent directly to the simulation.' },
    { t: 8, text: 'Courses of action are wargamed faster than real time, many times over, against different enemy options.' },
    { t: 14, text: 'Outcomes are analysed, the plan is refined, and the cycle repeats as the situation develops.' },
    { t: 20, text: 'Commanders and staff then rehearse the refined plan, on the same systems they will use in execution.' },
    { t: 24, text: 'With interoperability standards, this loop needs no manual re-entry of data between C2 and simulation.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const fmn: Schema = {
  id: 'fmn',
  category: 'Networks',
  title: 'Federated Mission Networking',
  subtitle: 'Mission networks built from national contributions, ready from day zero',
  duration: 36,
  description: 'FMN: affiliates contribute national network segments and services that federate into a mission network using common spiral specifications; M&S services such as C2SIM, HLA and MSaaS can be offered on it.',
  refs: [REF.fmn, REF.msaas, REF.c2sim, REF.hla],
  nodes: [
    { id: 'mn', shape: 'circle', x: 760, y: 360, w: 400, h: 400, label: 'Mission network', sub: 'one federated environment', icon: 'globe', c: 0, at: 6, size: 34 },
    { id: 'a1', x: 150, y: 230, w: 380, h: 130, label: 'Affiliate A', sub: 'national network & services', icon: 'shield', c: 1, at: 1 },
    { id: 'a2', x: 150, y: 470, w: 380, h: 130, label: 'Affiliate B', sub: 'national network & services', icon: 'shield', c: 2, at: 1.6 },
    { id: 'a3', x: 150, y: 710, w: 380, h: 130, label: 'NATO command structure', sub: 'NATO-provided services', icon: 'shield', c: 5, at: 2.2 },
    { id: 'a4', x: 1390, y: 230, w: 380, h: 130, label: 'Affiliate C', sub: 'mission partner', icon: 'shield', c: 3, at: 2.8 },
    { id: 's1', x: 1390, y: 470, w: 380, h: 130, label: 'C2 services', sub: 'situational awareness, messaging', icon: 'c2', c: 4, at: 14 },
    { id: 's2', x: 1390, y: 710, w: 380, h: 130, label: 'M&S services', sub: 'C2SIM · HLA/NETN · MSaaS', icon: 'sim', c: 6, at: 20 },
  ],
  links: [
    { a: 'a1', b: 'mn', at: 6.5, two: true, flows: [{ c: 1, t0: 8, every: 2.2, until: 35 }] },
    { a: 'a2', b: 'mn', at: 6.7, two: true, flows: [{ c: 2, t0: 8.6, every: 2.4, until: 35 }] },
    { a: 'a3', b: 'mn', at: 6.9, two: true, flows: [{ c: 5, t0: 9.2, every: 2.6, until: 35 }] },
    { a: 'a4', b: 'mn', at: 7.1, two: true, flows: [{ c: 3, t0: 9.8, every: 2.5, until: 35 }] },
    { a: 'mn', b: 's1', at: 14.5, two: true, flows: [{ label: 'COP', c: 4, t0: 15, every: 3, until: 35 }] },
    { a: 'mn', b: 's2', at: 20.5, two: true, flows: [{ label: 'orders / reports', c: 6, t0: 21, every: 3.5, until: 35 }] },
  ],
  highlights: [
    { t0: 1, t1: 5, ids: ['a1', 'a2', 'a3', 'a4'] },
    { t0: 6, t1: 13, ids: ['mn'] },
    { t0: 14, t1: 19, ids: ['s1'] },
    { t0: 20, t1: 27, ids: ['s2'] },
  ],
  draw: (g, t, th, h) => {
    // spiral specifications: incremental, overlapping releases
    const a = h.appear(t, 27, 1);
    if (a <= 0) return;
    const x0 = 560, y0 = 905;
    h.text('Spiral specifications', x0 - 20, y0, { size: 20, weight: 700, color: th.muted, align: 'right', alpha: a });
    for (let i = 0; i < 6; i++) {
      const p = h.appear(t, 27.5 + i * 0.5, 0.6);
      g.save();
      g.globalAlpha = p;
      const x = x0 + i * 140;
      g.beginPath();
      g.arc(x + 40, y0, 22 + i * 2, Math.PI, Math.PI * 3);
      g.strokeStyle = th.accents[i % th.accents.length];
      g.lineWidth = 4;
      g.stroke();
      h.text(`Spiral ${i + 1}`, x + 75, y0, { size: 18, weight: 600 });
      g.restore();
    }
  },
  captions: [
    { t: 0.5, text: 'Each mission partner, or affiliate, brings its own network segment, systems and services.' },
    { t: 6, text: 'Federated Mission Networking lets these contributions join quickly into one mission network, from day zero of an operation.' },
    { t: 14, text: 'Common C2 services such as situational awareness and messaging work across every affiliate.' },
    { t: 20, text: 'Modelling & simulation services can be offered on the same network: C2SIM, HLA federations with NETN, and M&S as a Service.' },
    { t: 27, text: 'Capabilities grow through successive spiral specifications that affiliates implement and verify together.' },
    { t: 32, text: 'Train as you fight: exercises run on the same federated network and services used on operations.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const lvcY = [250, 480, 710];
const lvc: Schema = {
  id: 'lvc',
  category: 'Training',
  title: 'Live, Virtual and Constructive together',
  subtitle: 'Real people with real equipment, crews in simulators and computer-generated forces in one exercise',
  duration: 32,
  description: 'LVC integration: live, virtual and constructive domains connected through gateways and a common architecture to C2 and exercise control.',
  refs: [REF.hla, REF.c2sim],
  nodes: [
    { id: 'L', x: 110, y: lvcY[0], w: 520, h: 150, label: 'Live', sub: 'real people, real equipment, instrumented range', icon: 'tank', c: 3, at: 1 },
    { id: 'V', x: 110, y: lvcY[1], w: 520, h: 150, label: 'Virtual', sub: 'real people operating simulators', icon: 'plane', c: 5, at: 3 },
    { id: 'C', x: 110, y: lvcY[2], w: 520, h: 150, label: 'Constructive', sub: 'simulated people and systems (CGF)', icon: 'sim', c: 2, at: 5 },
    { id: 'gw', shape: 'pill', x: 790, y: 450, w: 340, h: 210, label: 'Common architecture', sub: 'HLA · DIS · gateways', c: 1, at: 8, size: 28 },
    { id: 'c2', x: 1290, y: 300, w: 520, h: 150, label: 'Command & control', sub: 'one shared operational picture', icon: 'c2', c: 0, at: 13 },
    { id: 'ex', x: 1290, y: 560, w: 520, h: 150, label: 'Exercise control & AAR', sub: 'one scenario, one timeline', icon: 'chart', c: 4, at: 15 },
  ],
  links: [
    { a: 'L', b: 'gw', at: 8.5, two: true, flows: [{ label: 'TSPI', c: 3, t0: 9, every: 2.4, until: 31 }] },
    { a: 'V', b: 'gw', at: 8.7, two: true, flows: [{ label: 'entity state', c: 5, t0: 9.5, every: 2.2, until: 31 }] },
    { a: 'C', b: 'gw', at: 8.9, two: true, flows: [{ label: 'units', c: 2, t0: 10, every: 2.6, until: 31 }] },
    { a: 'gw', b: 'c2', at: 13.5, two: true, flows: [{ label: 'C2SIM', c: 0, t0: 14, every: 3, until: 31 }] },
    { a: 'gw', b: 'ex', at: 15.5, two: true, flows: [{ c: 4, t0: 16, every: 1.4, until: 31 }] },
  ],
  highlights: [
    { t0: 1, t1: 3, ids: ['L'] },
    { t0: 3, t1: 5, ids: ['V'] },
    { t0: 5, t1: 8, ids: ['C'] },
    { t0: 8, t1: 13, ids: ['gw'] },
    { t0: 13, t1: 20, ids: ['c2', 'ex'] },
  ],
  captions: [
    { t: 0.5, text: 'Live: real people operate real equipment on an instrumented range, with their positions tracked.' },
    { t: 3, text: 'Virtual: real people operate simulated systems, such as flight or vehicle simulators.' },
    { t: 5, text: 'Constructive: simulated people operate simulated systems, providing large forces at low cost.' },
    { t: 8, text: 'A common architecture and gateways put all three in the same synthetic battlespace.' },
    { t: 13, text: 'Commanders see one operational picture, and exercise control runs one scenario on one timeline.' },
    { t: 21, text: 'The mix is chosen per training objective: live where it matters, virtual and constructive for scale and safety.' },
  ],
};

// ---------------------------------------------------------------------------------------------
const LCIM: [string, string][] = [
  ['Level 0 · No interoperability', 'stand-alone systems'],
  ['Level 1 · Technical', 'bits and bytes are exchanged (network)'],
  ['Level 2 · Syntactic', 'a common data format (e.g. XML, HLA)'],
  ['Level 3 · Semantic', 'shared meaning (C2SIM ontology, FOM)'],
  ['Level 4 · Pragmatic', 'shared understanding of use & context'],
  ['Level 5 · Dynamic', 'state changes over time are understood'],
  ['Level 6 · Conceptual', 'fully aligned conceptual models'],
];
const lcimNodes: SNode[] = LCIM.map(([label, sub], i) => ({ id: 'l' + i, shape: 'layer', x: 260 + i * 40, y: 850 - i * 95, w: 1000 - i * 80, h: 82, label, sub, c: i % 7, at: 1.5 + i * 2.2, size: 24 }));
const lcim: Schema = {
  id: 'interop-levels',
  category: 'Process',
  title: 'Levels of interoperability',
  subtitle: 'Why connecting systems is only the first step',
  duration: 30,
  description: 'Levels of Conceptual Interoperability Model, from technical connection through syntactic and semantic agreement to conceptual alignment, with where standards contribute.',
  refs: [REF.lcim, REF.c2sim, REF.hla],
  nodes: [
    ...lcimNodes,
    { id: 'std1', shape: 'pill', x: 1420, y: 735, w: 380, h: 64, label: 'Networks · FMN', c: 1, at: 20 },
    { id: 'std2', shape: 'pill', x: 1420, y: 640, w: 380, h: 64, label: 'HLA · DIS · XML', c: 2, at: 21 },
    { id: 'std3', shape: 'pill', x: 1420, y: 545, w: 380, h: 64, label: 'C2SIM ontology · NETN-FOM', c: 3, at: 22 },
    { id: 'std4', shape: 'pill', x: 1420, y: 450, w: 380, h: 64, label: 'Federation agreements · DSEEP', c: 4, at: 23 },
  ],
  links: [
    { a: 'std1', b: 'l1', at: 20.3, dashed: true },
    { a: 'std2', b: 'l2', at: 21.3, dashed: true },
    { a: 'std3', b: 'l3', at: 22.3, dashed: true },
    { a: 'std4', b: 'l4', at: 23.3, dashed: true },
  ],
  highlights: LCIM.map((_, i) => ({ t0: 1.5 + i * 2.2, t1: 3.7 + i * 2.2, ids: ['l' + i] })).concat([{ t0: 20, t1: 26, ids: ['std1', 'std2', 'std3', 'std4'] }]),
  captions: [
    { t: 0.5, text: 'Interoperability has levels: each one builds on the one below.' },
    { t: 3.7, text: 'Technical and syntactic levels: systems are connected and agree on the data format.' },
    { t: 8, text: 'Semantic level: both sides mean the same thing by “unit”, “task” or “report”. This is what C2SIM’s ontology provides.' },
    { t: 12.5, text: 'Higher levels: shared context, behaviour over time, and finally fully aligned conceptual models.' },
    { t: 20, text: 'Standards address different levels: networks and FMN, HLA and data formats, ontologies and FOMs, agreements and process.' },
  ],
};

export const SCHEMAS: Schema[] = [c2simOverview, c2simStates, c2simOntology, hlaFederation, netnFom, dseep, cax, rehearsal, lvc, fmn, lcim];
