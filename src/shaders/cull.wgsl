struct Particle { p: vec4f, v: vec4f, w: vec4f }
struct Camera {
  view: mat4x4f, projection: mat4x4f, inverse: mat4x4f,
  eye: vec4f, box: vec4f, cursor: vec4f, style: vec4f,
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var pyramid: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> visible: array<u32>;
@group(0) @binding(4) var<storage, read_write> draw: array<atomic<u32>>;
@group(0) @binding(5) var<uniform> info: vec4u; // viewport width, height, count, mip count

fn keep(i: u32) { visible[atomicAdd(&draw[1],1u)]=i; }
@compute @workgroup_size(128)
fn cull(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;if(i>=info.z){return;}
  let p=particles[i].p;
  let center=(camera.view*vec4f(p.xyz,1)).xyz;
  if(center.z-p.w>=0.){return;}
  // Near-plane intersections are always retained. The drawing pipeline clips them.
  if(center.z+p.w>=-.01){keep(i);return;}
  let clip=camera.projection*vec4f(center,1);
  let expanded=p.w*length(center)/(-center.z-p.w);
  let extent=vec2f(camera.projection[0][0],camera.projection[1][1])*expanded/clip.w;
  let lo=clip.xy/clip.w-extent;let hi=clip.xy/clip.w+extent;
  if(any(hi<vec2f(-1)) || any(lo>vec2f(1))){return;}
  let front=camera.projection*vec4f(0,0,center.z+p.w,1);
  let nearest=front.z/front.w;
  if(nearest>1.){return;}
  if(nearest<0.){keep(i);return;}
  let size=vec2f(info.xy);
  // Whole-pixel bounds, including a guard pixel, conservatively contain the billboard.
  let pixelLo=max(vec2f(0),floor(vec2f(lo.x*.5+.5,.5-hi.y*.5)*size)-1.);
  let pixelHi=min(size-1.,ceil(vec2f(hi.x*.5+.5,.5-lo.y*.5)*size)+1.);
  // Level zero covers 2x2 pixels. At the selected level at most four texels
  // cover the entire rectangle. MAX depth, including clear pixels, keeps holes open.
  let span=max(pixelHi.x-pixelLo.x+1.,pixelHi.y-pixelLo.y+1.);
  let level=min(info.w-1u,u32(max(0.,ceil(log2(max(1.,span*.5))))));
  let scale=exp2(f32(level)+1.);
  let a=vec2i(floor(pixelLo/scale));let b=vec2i(floor(pixelHi/scale));
  let z=max(max(textureLoad(pyramid,a,i32(level)).x,textureLoad(pyramid,vec2i(b.x,a.y),i32(level)).x),
            max(textureLoad(pyramid,vec2i(a.x,b.y),i32(level)).x,textureLoad(pyramid,b,i32(level)).x));
  // Bias toward keeping a sphere when float depth precision is marginal.
  if(nearest<=z+0.0000002){keep(i);}
}
