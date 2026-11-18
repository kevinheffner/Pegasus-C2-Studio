/**
 * Main menu: choose between the 2D/3D COP Viewer and the Military Sensor Simulations workbench.
 * ?module=cop or ?module=sensors skips the menu (used by tests and bookmarks).
 */
let copStarted = false;
let sensorsStarted = false;
let vehiclesStarted = false;
let iosStarted = false;
let schemasStarted = false;

export function initHome(o: { startCop: () => Promise<void> }) {
  const app = document.getElementById('app')!;
  const home = document.createElement('div');
  home.id = 'home';
  home.innerHTML = `
    <div class="homeInner">
      <div class="homeBrand"><span class="sysmark">◆</span> SIMULATION CONTENT CREATOR</div>
      <div class="homeSub">Representative military C2 and sensor imagery &amp; video for training, demos and content</div>
      <div class="homeCards">
        <button class="homeCard" data-m="cop">
          <div class="hcIcon">🗺</div>
          <div class="hcName">2D / 3D COP Viewer</div>
          <div class="hcDesc">Command-and-control workstation facsimile: MIL-STD-2525 / APP-6 units and tactical graphics on real maps, simulated engagements, 1 or 4 views, intel / ORBAT / fires widgets, cinematic 3D camera sequences, video recording.</div>
        </button>
        <button class="homeCard" data-m="vehicles">
          <div class="hcIcon">✈</div>
          <div class="hcName">3D Vehicle Simulations</div>
          <div class="hcDesc">CesiumJS globe with real terrain, satellite imagery, sun, shadows and animated ocean: aircraft, armored vehicles and ships moving along real roads, rivers and flight paths, with cinematic chase / orbit / flyby cameras and MP4 recording.</div>
        </button>
        <button class="homeCard" data-m="sensors">
          <div class="hcIcon">📡</div>
          <div class="hcName">Military Sensor Simulations</div>
          <div class="hcDesc">Representative sensor displays driven by the same scenarios: EO/IR (FLIR) gimbal video, SAR imagery, GMTI radar scope, ESM / SIGINT spectrum waterfall with PDW streams, sonar waterfalls — with JSON / CSV metadata exports.</div>
        </button>
        <button class="homeCard" data-m="ios">
          <div class="hcIcon">🎓</div>
          <div class="hcName">Instructor View</div>
          <div class="hcDesc">Instructor operator station on one or two monitors: master event list with scheduled, conditional and manual injects, ground-truth tactical map with threat rings, trainee station repeaters, objectives, KPIs, session timeline, freeze / step / snapshots and journal.</div>
        </button>
        <button class="homeCard" data-m="schemas">
          <div class="hcIcon">◇</div>
          <div class="hcName">Animated Schemas</div>
          <div class="hcDesc">Animated explanatory graphics on how C2 systems and simulations come together: C2SIM, HLA and NETN, DSEEP, FMN, computer-assisted exercises, mission rehearsal and LVC. Export as images, storyboards, animated GIFs and videos.</div>
        </button>
      </div>
      <div class="homeFoot">Synthetic content · all units fictional · free &amp; open-source components</div>
    </div>`;
  document.body.appendChild(home);
  app.style.display = 'none';

  const go = async (m: string) => {
    home.style.display = 'none';
    if (new URLSearchParams(location.search).get('module') !== m) history.replaceState(null, '', `?module=${m}${location.search.includes('pkg=') ? '&' + location.search.split(/[?&]/).find((x) => x.startsWith('pkg=')) : ''}`);
    for (const id of ['sensorApp', 'vehApp', 'iosApp', 'schApp']) document.getElementById(id)?.style.setProperty('display', 'none');
    if (m === 'cop') {
      app.style.display = '';
      if (!copStarted) {
        copStarted = true;
        await o.startCop();
      }
    } else if (m === 'schemas') {
      app.style.display = 'none';
      if (!schemasStarted) {
        schemasStarted = true;
        const mod = await import('./schemas/app');
        await mod.initSchemas();
      }
      document.getElementById('schApp')!.style.display = '';
    } else if (m === 'ios') {
      app.style.display = 'none';
      if (!iosStarted) {
        iosStarted = true;
        const mod = await import('./ios/app');
        await mod.initIOS();
      }
      document.getElementById('iosApp')!.style.display = '';
    } else if (m === 'vehicles') {
      app.style.display = 'none';
      if (!vehiclesStarted) {
        vehiclesStarted = true;
        const mod = await import('./vehicles/app');
        await mod.initVehicles();
      }
      document.getElementById('vehApp')!.style.display = '';
    } else {
      app.style.display = 'none';
      const mod = await import('./sensor/app');
      if (!sensorsStarted) {
        sensorsStarted = true;
        await mod.initSensors();
      }
      document.getElementById('sensorApp')!.style.display = '';
    }
  };
  home.querySelectorAll<HTMLButtonElement>('.homeCard').forEach((b) => (b.onclick = () => go(b.dataset.m!)));
  const showHome = () => {
    app.style.display = 'none';
    for (const id of ['sensorApp', 'vehApp', 'iosApp', 'schApp']) document.getElementById(id)?.style.setProperty('display', 'none');
    home.style.display = '';
    history.replaceState(null, '', location.pathname);
  };
  (window as any).sccHome = showHome;
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.sys')) showHome();
  });
  const m = new URLSearchParams(location.search).get('module') ?? (new URLSearchParams(location.search).has('autogen') || new URLSearchParams(location.search).has('look') ? 'cop' : null);
  if (m === 'cop' || m === 'sensors' || m === 'vehicles' || m === 'ios' || m === 'schemas') go(m);
}
