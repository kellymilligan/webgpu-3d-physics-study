export const defaults = {
  count: 1000, radius: 0.16, variation: 8, variationBias: 3, width: 24, height: 18, depth: 16,
  shape_sphere: true, shape_cube: true, shape_sphube: true, shape_capsule: true,
  shape_cylinder: true, shape_tetrahedron: true, shape_octahedron: true, shape_box: true,
  gravity: 9.81, restitution: 0.12, friction: 0.45, mass: 1, damping: 0.08,
  substeps: 4, timeScale: 1, paused: false,
  cursorRadius: 1.5, cursorStrength: 1, cursorDepth: 0.5,
  shadows: true, shadowResolution: 2048, shadowSoftness: 2.5, shadowBias: .005,
  lightRig: 'studio', stripLength: 24, stripWidth: 4,
  lightAzimuth: -35, lightElevation: 52, lightIntensity: 3.2, ambientStrength: .5,
  roughness: .38, metallic: 0, exposure: 1,
  materialMix: true, glassShare: .3, chromeShare: .3, glassIOR: 1.5, glassTint: .12, softboxSize: 12, glowStrength: 4, frosting: .65,
  ao: true, aoRadius: .65, aoStrength: 1.3, aoQuality: 1, debugLighting: 0,
  culling: true, pixelRatio: 1, color: 3, seed: 42,
};
export const counts = { '100':100, '250':250, '500':500, '1k':1000, '2k':2000, '5k':5000 };
export function fitRadius(s) {
  const crowd=Math.cbrt((s.width*s.height*.55*s.depth)/Math.max(1,s.count));
  return Math.max(.01,Math.floor(crowd*.18/Math.max(1,Math.sqrt(s.variation))*1000)/1000);
}
