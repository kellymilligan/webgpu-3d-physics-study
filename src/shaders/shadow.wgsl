struct Lighting {
 inverseProjection:mat4x4f,lightView:mat4x4f,lightProjection:mat4x4f,
 direction:vec4f,ambient:vec4f,shadow:vec4f,occlusion:vec4f,viewport:vec4f,options:vec4f,
}
@group(0) @binding(0) var<uniform> light:Lighting;
@group(0) @binding(1) var<storage,read> bodies:array<Body>;
struct ShadowVertex {
 @builtin(position) position:vec4f,@location(0) uv:vec2f,
 @location(1) @interpolate(flat) center:vec3f,@location(2) @interpolate(flat) bound:f32,
 @location(3) @interpolate(flat) rotation:vec4f,@location(4) @interpolate(flat) shape:vec4f,
}
@vertex fn vertex(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->ShadowVertex {
 let c=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
 let body=bodies[i];let center=(light.lightView*vec4f(body.p.xyz,1)).xyz;let uv=c[v];
 return ShadowVertex(light.lightProjection*vec4f(center+vec3f(uv*body.p.w,0),1),uv,body.p.xyz,body.p.w,body.q,body.shape);
}
@fragment fn fragment(in:ShadowVertex)->@builtin(frag_depth) f32 {
 let rotation=transpose(mat3x3f(light.lightView[0].xyz,light.lightView[1].xyz,light.lightView[2].xyz));
 let origin=in.center+rotation*vec3f(in.uv*in.bound,0)+light.direction.xyz*in.bound;
 let hit=intersectShape(origin,-light.direction.xyz,in.center,in.rotation,in.shape,in.bound);
 if(hit.t<0.){discard;}let world=origin-light.direction.xyz*hit.t;let clip=light.lightProjection*light.lightView*vec4f(world,1);return clip.z/clip.w;
}
