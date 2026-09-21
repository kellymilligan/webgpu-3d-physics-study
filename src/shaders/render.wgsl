struct Camera {view:mat4x4f,projection:mat4x4f,inverse:mat4x4f,eye:vec4f,box:vec4f,cursor:vec4f,style:vec4f}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> bodies:array<Body>;
@group(0) @binding(2) var<storage,read> visibleIDs:array<u32>;
struct Varying {
 @builtin(position) position:vec4f,@location(0) uv:vec2f,
 @location(1) @interpolate(flat) centerView:vec3f,@location(2) @interpolate(flat) centerWorld:vec3f,
 @location(3) @interpolate(flat) bound:f32,@location(4) @interpolate(flat) color:vec3f,
 @location(5) @interpolate(flat) kind:u32,@location(6) @interpolate(flat) rotation:vec4f,
 @location(7) @interpolate(flat) shape:vec4f,
}
fn corner(i:u32)->vec2f {let c=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));return c[i];}
@vertex fn sphereVertex(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->Varying {
 var id=i;if(camera.style.z>.5&&camera.style.y<.5){id=visibleIDs[i];}
 var body=bodies[id];var p=body.p;var q=body.q;var shape=body.shape;var color=paletteColor(id,camera.style.x);
 if(camera.style.y>.5){p=camera.cursor;q=vec4f(0,0,0,1);shape=vec4f(0,camera.cursor.w,0,0);color=vec3f(.95,.52,.22);}
 let center=(camera.view*vec4f(p.xyz,1)).xyz;let uv=corner(v);let expanded=p.w*length(center)/max(.001,-center.z-p.w);
 return Varying(camera.projection*vec4f(center+vec3f(uv*expanded,0),1),uv,center,p.xyz,p.w,color,materialKind(id,camera.style.w),q,shape);
}
fn worldDirection(in:Varying)->vec3f {let expanded=in.bound*length(in.centerView)/max(.001,-in.centerView.z-in.bound);return normalize((camera.inverse*vec4f(normalize(in.centerView+vec3f(in.uv*expanded,0)),0)).xyz);}
fn hitFor(in:Varying)->ShapeHit {return intersectShape(camera.eye.xyz,worldDirection(in),in.centerWorld,in.rotation,in.shape,in.bound);}
struct Fragment {@location(0) color:vec4f,@builtin(frag_depth) depth:f32}
@fragment fn sphereFragment(in:Varying)->Fragment {
 let hit=hitFor(in);if(hit.t<0.){discard;}let direction=worldDirection(in);let world=camera.eye.xyz+direction*hit.t;
 let n=qRotate(in.rotation,hit.normal);let v=normalize(camera.eye.xyz-world);let light=normalize(vec3f(-.5,1,.7));let rim=pow(1.-max(0.,dot(n,v)),3.)*.11;
 let color=in.color*(.31+.69*max(0.,dot(n,light)))+pow(max(0.,dot(n,normalize(v+light))),60.)*.32+rim;
 let projected=camera.projection*camera.view*vec4f(world,1);return Fragment(vec4f(pow(color,vec3f(1./2.2)),.65+rim*3.),projected.z/projected.w);
}
@fragment fn sphereDepth(in:Varying)->@builtin(frag_depth) f32 {let hit=hitFor(in);if(hit.t<0.){discard;}let world=camera.eye.xyz+worldDirection(in)*hit.t;let p=camera.projection*camera.view*vec4f(world,1);return p.z/p.w;}
struct GBuffer {@location(0) albedo:vec4f,@location(1) normal:vec4f,@builtin(frag_depth) depth:f32}
@fragment fn sphereGeometry(in:Varying)->GBuffer {
 let hit=hitFor(in);if(hit.t<0.){discard;}let world=camera.eye.xyz+worldDirection(in)*hit.t;
 let normal=normalize((camera.view*vec4f(qRotate(in.rotation,hit.normal),0)).xyz);let clip=camera.projection*camera.view*vec4f(world,1);
 return GBuffer(vec4f(in.color,f32(in.kind+1u)*.1),vec4f(normal,0),clip.z/clip.w);
}
struct GroundVarying {@builtin(position) position:vec4f,@location(0) point:vec3f}
@vertex fn groundVertex(@builtin(vertex_index) i:u32)->GroundVarying {let uv=corner(i);let p=vec3f(uv.x*camera.box.x,0,uv.y*camera.box.z);return GroundVarying(camera.projection*camera.view*vec4f(p,1),p);}
struct GroundBuffer {@location(0) albedo:vec4f,@location(1) normal:vec4f}
@fragment fn groundGeometry(in:GroundVarying)->GroundBuffer {let n=(camera.view*vec4f(0,1,0,0)).xyz;return GroundBuffer(vec4f(select(vec3f(.14,.155,.17),vec3f(.004),camera.style.x>4.5),0),vec4f(n,0));}
