export const defaults = {
  count: 100000, radius: 0.11, variation: 0, width: 24, height: 18, depth: 16,
  gravity: 9.81, restitution: 0.12, friction: 0.45, mass: 1, damping: 0.08,
  substeps: 2, iterations: 2, timeScale: 1, paused: false,
  cursorRadius: 1.5, cursorStrength: 1, cursorDepth: 0.5,
  shadows: true, shadowResolution: 2048, shadowSoftness: 2.5, shadowBias: .005,
  lightAzimuth: -35, lightElevation: 52, lightIntensity: 3.2, ambientStrength: .5,
  roughness: .38, metallic: 0, exposure: 1,
  materialMix: true, glassShare: .3, chromeShare: .3, glassIOR: 1.5, glassTint: .12, softboxSize: 12,
  ao: true, aoRadius: .65, aoStrength: 1.3, aoQuality: 1, debugLighting: 0,
  culling: true, pixelRatio: 1, color: 3, seed: 42,
};
export const counts = { '10k':10000, '100k':100000, '200k':200000, '500k':500000, '1m':1000000, '2m':2000000 };
export function layout(s) {
  const spacing = s.radius * (1 + 4 * s.variation) * 2.04;
  const nx = Math.floor(s.width / spacing), nz = Math.floor(s.depth / spacing), ny = Math.floor(s.height / spacing);
  return { spacing, nx, nz, ny, capacity: nx * nz * ny };
}
// Fit a conservative non-overlapping lattice in the upper ~55% of the box.
export function fitRadius(s) {
  let lo=0.0001, hi=Math.min(s.width,s.height,s.depth)/2/(1+4*s.variation);
  for(let k=0;k<40;k++) {
    const r=(lo+hi)/2;
    if(layout({...s,radius:r,height:s.height*.55}).capacity>=s.count)lo=r;else hi=r;
  }
  return Math.floor(lo*100000)/100000;
}
export async function makeSeeds(s, wasmURL) {
  const response = await fetch(wasmURL);
  if (!response.ok) throw new Error('Could not load the WASM initializer.');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
  const {memory,seed} = instance.exports;
  const pages=Math.ceil(s.count*48/65536);
  if(pages>1)memory.grow(pages-1);
  const l=layout(s);
  if(l.capacity<s.count)throw new Error('Spheres do not fit. Use Fit radius or enlarge the box.');
  seed(s.count,l.nx,l.nz,s.width,s.height,s.depth,s.radius,s.variation,s.mass,l.spacing,s.seed);
  return new Float32Array(memory.buffer,0,s.count*12);
}
