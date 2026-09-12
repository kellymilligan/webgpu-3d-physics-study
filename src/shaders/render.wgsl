struct Particle { p: vec4f, v: vec4f, w: vec4f }
struct Camera {
  view: mat4x4f, projection: mat4x4f, inverse: mat4x4f,
  eye: vec4f, box: vec4f, cursor: vec4f, style: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> visibleIDs: array<u32>;
struct Varying {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) center: vec3f,
  @location(2) @interpolate(flat) radius: f32,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) kind:u32,
}
fn corner(i:u32)->vec2f {
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  return corners[i];
}
fn colorFor(i:u32)->vec3f {return paletteColor(i,camera.style.x);}
@vertex fn sphereVertex(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->Varying {
  var particleID=i;
  if(camera.style.z>.5 && camera.style.y<.5){particleID=visibleIDs[i];}
  var p=particles[particleID].p;var color=colorFor(particleID);
  if(camera.style.y>0.5){p=camera.cursor;color=vec3f(.95,.52,.22);}
  let center=(camera.view*vec4f(p.xyz,1)).xyz;
  let uv=corner(v);
  // Expand the billboard for perspective; fragment ray intersection determines its exact silhouette.
  let expanded=p.w*length(center)/max(.001,-center.z-p.w);
  let position=camera.projection*vec4f(center+vec3f(uv*expanded,0),1);
  return Varying(position,uv,center,p.w,color,materialKind(particleID,camera.style.w));
}
struct Fragment { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
@fragment fn sphereFragment(in:Varying)->Fragment {
  let expanded=in.radius*length(in.center)/max(.001,-in.center.z-in.radius);
  let ray=normalize(in.center+vec3f(in.uv*expanded,0));
  let b=dot(ray,in.center);let h=b*b-dot(in.center,in.center)+in.radius*in.radius;
  if(h<0.){discard;}
  let hit=ray*(b-sqrt(h));let normal=(hit-in.center)/in.radius;
  let worldNormal=normalize((camera.inverse*vec4f(normal,0)).xyz);
  let world=(camera.inverse*vec4f(hit,1)).xyz;
  let light=normalize(vec3f(-.5,1.,.7));
  let diffuse=max(0.,dot(worldNormal,light));
  let halfVector=normalize(normalize(camera.eye.xyz-world)+light);
  let spec=pow(max(0.,dot(worldNormal,halfVector)),60.)*.32;
  let rim=pow(1.-max(0.,dot(normal,-ray)),3.)*.11;
  let floorAO=mix(.6,1.,smoothstep(0.,in.radius*3.,world.y));
  let color=in.color*(.31+.69*diffuse)*floorAO+spec+rim;
  let projected=camera.projection*vec4f(hit,1);
  let alpha=select(1.,.65+rim*3.,camera.style.y>.5);
  return Fragment(vec4f(pow(color,vec3f(1./2.2)),alpha),projected.z/projected.w);
}
struct GroundVarying { @builtin(position) position:vec4f, @location(0) point:vec3f }
@vertex fn groundVertex(@builtin(vertex_index) i:u32)->GroundVarying {
  let uv=corner(i);let p=vec3f(uv.x*camera.box.x,0,uv.y*camera.box.z);
  return GroundVarying(camera.projection*camera.view*vec4f(p,1),p);
}
@fragment fn groundFragment(in:GroundVarying)->@location(0) vec4f {
  let edge=min(camera.box.x-abs(in.point.x),camera.box.z-abs(in.point.z));
  let glow=1.-smoothstep(0.,.04,edge);
  let falloff=1.-.2*length(in.point.xz/vec2f(camera.box.x,camera.box.z));
  return vec4f((vec3f(.17,.19,.20)*falloff)+glow*.035,1);
}

// Depth-only occluders share exactly the color pass sphere intersection.
@fragment fn sphereDepth(in:Varying)->@builtin(frag_depth) f32 {
  let expanded=in.radius*length(in.center)/max(.001,-in.center.z-in.radius);
  let ray=normalize(in.center+vec3f(in.uv*expanded,0));
  let b=dot(ray,in.center);let h=b*b-dot(in.center,in.center)+in.radius*in.radius;
  if(h<0.){discard;}
  let hit=ray*(b-sqrt(h));
  let projected=camera.projection*vec4f(hit,1);
  return projected.z/projected.w;
}

struct GBuffer { @location(0) albedo:vec4f, @location(1) normal:vec4f, @builtin(frag_depth) depth:f32 }
@fragment fn sphereGeometry(in:Varying)->GBuffer {
  let expanded=in.radius*length(in.center)/max(.001,-in.center.z-in.radius);
  let ray=normalize(in.center+vec3f(in.uv*expanded,0));
  let b=dot(ray,in.center);let h=b*b-dot(in.center,in.center)+in.radius*in.radius;
  if(h<0.){discard;}
  let hit=ray*(b-sqrt(h));let normal=normalize(hit-in.center);
  let clip=camera.projection*vec4f(hit,1);
  return GBuffer(vec4f(in.color,f32(in.kind+1u)*.2),vec4f(normal,in.radius),clip.z/clip.w);
}
struct GroundBuffer { @location(0) albedo:vec4f, @location(1) normal:vec4f }
@fragment fn groundGeometry(in:GroundVarying)->GroundBuffer {
  let n=(camera.view*vec4f(0,1,0,0)).xyz;
  return GroundBuffer(vec4f(.14,.155,.17,0),vec4f(n,0));
}
