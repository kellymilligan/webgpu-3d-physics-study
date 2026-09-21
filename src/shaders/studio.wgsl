struct StudioLight {
  center:vec4f, // position, area
  normal:vec4f, // emitting face toward scene
  right:vec4f, // unit axis, half width
  up:vec4f, // unit axis, half length
  radiance:vec4f,
}
fn stripDistance(strip:StudioLight,origin:vec3f,direction:vec3f)->f32 {
  let denominator=dot(direction,strip.normal.xyz);
  if(abs(denominator)<.000001){return 1e30;}
  let t=dot(strip.center.xyz-origin,strip.normal.xyz)/denominator;
  if(t<=.000001){return 1e30;}
  let p=origin+direction*t-strip.center.xyz;
  return select(1e30,t,abs(dot(p,strip.right.xyz))<=strip.right.w&&abs(dot(p,strip.up.xyz))<=strip.up.w);
}
