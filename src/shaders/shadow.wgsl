struct Particle { p: vec4f, v: vec4f, w: vec4f }
struct Lighting {
  inverseProjection: mat4x4f, lightView: mat4x4f, lightProjection: mat4x4f,
  direction:vec4f, ambient:vec4f, shadow:vec4f, occlusion:vec4f, viewport:vec4f, options:vec4f,
}
@group(0) @binding(0) var<uniform> light:Lighting;
@group(0) @binding(1) var<storage,read> particles:array<Particle>;
struct ShadowVertex {
  @builtin(position) position:vec4f,
  @location(0) uv:vec2f,
  @location(1) @interpolate(flat) center:vec3f,
  @location(2) @interpolate(flat) radius:f32,
}
@vertex fn vertex(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->ShadowVertex {
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let p=particles[i].p;let center=(light.lightView*vec4f(p.xyz,1)).xyz;
  let uv=corners[v];
  return ShadowVertex(light.lightProjection*vec4f(center+vec3f(uv*p.w,0),1),uv,center,p.w);
}
@fragment fn fragment(in:ShadowVertex)->@builtin(frag_depth) f32 {
  let d=dot(in.uv,in.uv);if(d>1.){discard;}
  let surface=in.center+vec3f(in.uv,sqrt(max(0.,1.-d)))*in.radius;
  let clip=light.lightProjection*vec4f(surface,1);
  return clip.z/clip.w;
}
