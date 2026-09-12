struct Camera {
  view: mat4x4f, projection: mat4x4f, inverse: mat4x4f,
  eye: vec4f, box: vec4f, cursor: vec4f, style: vec4f,
}
struct Lighting {
  inverseProjection: mat4x4f,
  lightView: mat4x4f,
  lightProjection: mat4x4f,
  direction: vec4f, // surface-to-light direction, intensity
  ambient: vec4f, // ambient strength, roughness, metallic, exposure
  shadow: vec4f, // enabled, filter radius in texels, receiver bias in world units, resolution
  occlusion: vec4f, // enabled, radius in world units, strength, unused
  viewport: vec4f, // full width/height, AO width/height
  options: vec4f, // AO directions, steps, debug view, unused
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> light: Lighting;
fn viewPosition(pixel:vec2f,depth:f32)->vec3f {
  let uv=pixel/light.viewport.xy;
  let p=light.inverseProjection*vec4f(uv.x*2.-1.,1.-uv.y*2.,depth,1.);
  return p.xyz/p.w;
}
