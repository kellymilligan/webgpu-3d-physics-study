struct Params {
  inverseProjection:mat4x4f, cameraWorld:mat4x4f,
  image:vec4u, // full width/height, tile x/y
  tile:vec4u, // tile width/height, sample index, max bounces
  box:vec4f, // half-width, height, half-depth, palette
  material:vec4f, // packed mix, uniform roughness, metallic, glass IOR
  lightCenter:vec4f, // xyz, radius
  lightNormal:vec4f, // points from disk toward scene, radiance
  lightRight:vec4f, lightUp:vec4f,
  environment:vec4f, // strength, exposure, glass tint, unused
}
struct Node { lo:vec3f, a:u32, hi:vec3f, b:u32 }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> spheres:array<vec4f>;
@group(0) @binding(2) var<storage,read> indices:array<u32>;
@group(0) @binding(3) var<storage,read> nodes:array<Node>;
@group(0) @binding(4) var<storage,read_write> accumulation:array<vec4f>;
const PI:f32=3.14159265359;
const INF:f32=1e30;
const FLOOR:u32=0xfffffffeu;
const MISS:u32=0xffffffffu;
struct Hit { t:f32, id:u32 }
var<private> rng:u32;
fn random()->f32 {rng=materialHash(rng+0x9e3779b9u);return (f32(rng>>8u)+.5)/16777216.;}
fn basis(n:vec3f)->mat3x3f {let axis=select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.9);let t=normalize(cross(axis,n));return mat3x3f(t,cross(n,t),n);}
fn boxNear(origin:vec3f,inv:vec3f,node:Node,limit:f32)->f32 {
  let a=(node.lo-origin)*inv;let b=(node.hi-origin)*inv;
  let small=min(a,b);let big=max(a,b);let near=max(0.,max(small.x,max(small.y,small.z)));let far=min(limit,min(big.x,min(big.y,big.z)));
  return select(INF,near,far>=near);
}
fn trace(origin:vec3f,direction:vec3f,limit:f32)->Hit {
  // Clamp zero components for robust slab intersections at exact axial directions.
  let safe=select(direction,select(vec3f(-1e-20),vec3f(1e-20),direction>=vec3f(0)),abs(direction)<vec3f(1e-20));
  let inverse=1./safe;var hit=Hit(limit,MISS);var stack:array<u32,48>;var top=1u;stack[0]=0u;
  loop {
    if(top==0u){break;}top--;let index=stack[top];let node=nodes[index];
    if(boxNear(origin,inverse,node,hit.t)==INF){continue;}
    if((node.b&0x80000000u)!=0u){
      let count=node.b&0x7fffffffu;
      for(var j=0u;j<count;j++){
        let id=indices[node.a+j];let sphere=spheres[id];let oc=origin-sphere.xyz;
        let b=dot(oc,direction);let perpendicular=oc-direction*b;
        let h=sphere.w*sphere.w-dot(perpendicular,perpendicular);
        if(h<0.){continue;}let root=sqrt(h);var t=-b-root;if(t<=.000001){t=-b+root;}
        if(t>.000001&&t<hit.t){hit=Hit(t,id);}
      }
    }else{
      let a=boxNear(origin,inverse,nodes[node.a],hit.t);let b=boxNear(origin,inverse,nodes[node.b],hit.t);
      // Morton tree depth is <= 19 at 2m bodies, below the fixed stack capacity.
      if(a<b){if(b!=INF){stack[top]=node.b;top++;}if(a!=INF){stack[top]=node.a;top++;}}
      else{if(a!=INF){stack[top]=node.a;top++;}if(b!=INF){stack[top]=node.b;top++;}}
    }
  }
  if(abs(direction.y)>1e-8){let t=-origin.y/direction.y;let p=origin+t*direction;
    if(t>.000001&&t<hit.t&&abs(p.x)<=params.box.x&&abs(p.z)<=params.box.z){hit=Hit(t,FLOOR);}}
  return hit;
}
fn diskDistance(origin:vec3f,direction:vec3f)->f32 {
  let denominator=dot(direction,params.lightNormal.xyz);if(denominator>=-.000001){return INF;}
  let t=dot(params.lightCenter.xyz-origin,params.lightNormal.xyz)/denominator;
  if(t<=.000001){return INF;}let p=origin+direction*t-params.lightCenter.xyz;
  return select(INF,t,dot(p,p)<=params.lightCenter.w*params.lightCenter.w);
}
fn emission()->vec3f {return vec3f(1.,.96,.89)*params.lightNormal.w;}
fn environment(d:vec3f)->vec3f {return mix(vec3f(.16,.14,.11),vec3f(.57,.64,.75),d.y*.5+.5)*params.environment.x;}
fn power(a:f32,b:f32)->f32 {let aa=a*a;return aa/max(1e-20,aa+b*b);}
fn diskPDF(origin:vec3f,direction:vec3f,t:f32)->f32 {
  return t*t/max(1e-12,PI*params.lightCenter.w*params.lightCenter.w*abs(dot(params.lightNormal.xyz,direction)));
}
fn schlick(f0:vec3f,c:f32)->vec3f {return f0+(1.-f0)*pow(clamp(1.-c,0.,1.),5.);}
struct BSDF { f:vec3f, pdf:f32 }
fn evalBSDF(n:vec3f,v:vec3f,l:vec3f,base:vec3f,roughness:f32,metal:f32)->BSDF {
  let nv=dot(n,v);let nl=dot(n,l);if(nv<=0.||nl<=0.){return BSDF(vec3f(0),0.);}
  let h=normalize(v+l);let nh=max(0.,dot(n,h));let vh=max(.000001,dot(v,h));
  let alpha=roughness*roughness;let a2=alpha*alpha;let den=nh*nh*(a2-1.)+1.;let d=a2/max(1e-12,PI*den*den);
  let gv=nl*sqrt(nv*nv*(1.-a2)+a2);let gl=nv*sqrt(nl*nl*(1.-a2)+a2);let visibility=.5/max(1e-12,gv+gl);
  let f=schlick(mix(vec3f(.04),base,metal),vh);let specProbability=mix(.25,1.,metal);
  return BSDF((1.-f)*(1.-metal)*base/PI+d*visibility*f,mix(nl/PI,d*nh/(4.*vh),specProbability));
}
fn dielectric(cosine:f32,eta:f32)->f32 {
  let sinT2=(1.-cosine*cosine)/(eta*eta);if(sinT2>=1.){return 1.;}let ct=sqrt(max(0.,1.-sinT2));
  let parallel=(eta*cosine-ct)/(eta*cosine+ct);let perpendicular=(cosine-eta*ct)/(cosine+eta*ct);
  return .5*(parallel*parallel+perpendicular*perpendicular);
}
fn sampleBSDF(n:vec3f,v:vec3f,roughness:f32,metal:f32)->vec3f {
  let frame=basis(n);let u=random();let phi=2.*PI*random();
  if(random()<mix(.25,1.,metal)){
    let alpha=roughness*roughness;let cosTheta=sqrt((1.-u)/(1.+(alpha*alpha-1.)*u));let sinTheta=sqrt(max(0.,1.-cosTheta*cosTheta));
    let h=frame*vec3f(cos(phi)*sinTheta,sin(phi)*sinTheta,cosTheta);return reflect(-v,h);
  }
  return frame*vec3f(sqrt(u)*cos(phi),sqrt(u)*sin(phi),sqrt(1.-u));
}
@compute @workgroup_size(8,8)
fn render(@builtin(global_invocation_id) global:vec3u) {
  if(any(global.xy>=params.tile.xy)){return;}
  let pixel=params.image.zw+global.xy;let index=global.y*params.tile.x+global.x;
  rng=materialHash(pixel.x+pixel.y*params.image.x)^materialHash(params.tile.z+12347u);
  let uv=(vec2f(pixel)+vec2f(random(),random()))/vec2f(params.image.xy);
  let projected=params.inverseProjection*vec4f(uv.x*2.-1.,1.-uv.y*2.,.5,1.);
  var direction=normalize((params.cameraWorld*vec4f(normalize(projected.xyz/projected.w),0)).xyz);
  var origin=params.cameraWorld[3].xyz;var throughput=vec3f(1);var radiance=vec3f(0);
  var previousPdf=0.;var previousNormal=vec3f(0);var previousOrigin=origin;var deltaEvent=true;
  var absorption=vec3f(0);
  for(var bounce=0u;bounce<params.tile.w;bounce++){
    let disk=diskDistance(origin,direction);let hit=trace(origin,direction,disk);
    if(hit.id==MISS){
      if(disk!=INF){let weight=select(power(previousPdf,.5*diskPDF(previousOrigin,direction,disk)),1.,deltaEvent);radiance+=throughput*emission()*weight;}
      else{let envPDF=select(0.,.5/(2.*PI),dot(previousNormal,direction)>0.);let weight=select(power(previousPdf,envPDF),1.,deltaEvent);radiance+=throughput*environment(direction)*weight;}
      break;
    }
    throughput*=exp(-absorption*hit.t);
    let point=origin+direction*hit.t;var outward=vec3f(0,1,0);var radius=1.;var kind=1u;var base=vec3f(.14,.155,.17);var roughness=.85;var metallic=0.;
    if(hit.id!=FLOOR){
      let sphere=spheres[hit.id];radius=sphere.w;outward=normalize(point-sphere.xyz);kind=materialKind(hit.id,params.material.x);base=paletteColor(hit.id,params.box.w);
      roughness=params.material.y;metallic=params.material.z;
      if(kind==1u){roughness=.82;metallic=0.;}if(kind==2u){base=vec3f(.93,.94,.96);roughness=.055;metallic=1.;}
    }
    let entering=dot(direction,outward)<0.;let n=select(-outward,outward,entering);let v=-direction;let epsilon=max(.000002,radius*.00015);
    previousOrigin=point;previousNormal=n;
    if(kind==3u){
      let eta=select(1./params.material.w,params.material.w,entering);let f=dielectric(clamp(dot(n,v),0.,1.),eta);
      if(random()<f){direction=reflect(direction,n);}else{
        direction=normalize(refract(direction,n,1./eta));throughput/=eta*eta;
        if(entering){absorption=-log(mix(vec3f(1),max(base,vec3f(.05)),params.environment.z))/max(.001,2.*radius);}
        else{absorption=vec3f(0);}
      }
      deltaEvent=true;previousPdf=0.;
    }else{
      // Next-event estimation: choose an area-light sample or a cosine-independent
      // hemisphere environment sample, then combine with BSDF paths using MIS.
      var lightDirection=vec3f(0);var lightDistance=INF;var incoming=vec3f(0);var lightPdf=0.;
      if(random()<.5){
        let r=params.lightCenter.w*sqrt(random());let phi=2.*PI*random();
        let lightPoint=params.lightCenter.xyz+params.lightRight.xyz*(r*cos(phi))+params.lightUp.xyz*(r*sin(phi));
        let diff=lightPoint-point;lightDistance=length(diff);lightDirection=diff/lightDistance;
        lightPdf=.5*diskPDF(point,lightDirection,lightDistance);incoming=emission();
      }else{
        let z=random();let phi=2.*PI*random();lightDirection=basis(n)*vec3f(sqrt(1.-z*z)*cos(phi),sqrt(1.-z*z)*sin(phi),z);
        lightPdf=.5/(2.*PI);incoming=environment(lightDirection);
        // The disk is an opaque emitter, so environment paths cannot pass through it.
        if(diskDistance(point+n*epsilon,lightDirection)!=INF){incoming=vec3f(0);}
      }
      let bsdf=evalBSDF(n,v,lightDirection,base,roughness,metallic);
      if(bsdf.pdf>0.&&lightPdf>0.&&any(incoming>vec3f(0))){
        if(trace(point+n*epsilon,lightDirection,lightDistance-epsilon*2.).id==MISS){radiance+=throughput*bsdf.f*max(0.,dot(n,lightDirection))*incoming*power(lightPdf,bsdf.pdf)/lightPdf;}
      }
      direction=sampleBSDF(n,v,roughness,metallic);let sampled=evalBSDF(n,v,direction,base,roughness,metallic);
      if(sampled.pdf<=1e-12){break;}throughput*=sampled.f*max(0.,dot(n,direction))/sampled.pdf;previousPdf=sampled.pdf;deltaEvent=false;
    }
    origin=point+outward*select(-epsilon,epsilon,dot(direction,outward)>0.);
    if(bounce>=4u){let survival=clamp(max(throughput.x,max(throughput.y,throughput.z)),.05,.95);if(random()>survival){break;}throughput/=survival;}
  }
  let old=select(accumulation[index],vec4f(0),params.tile.z==0u);
  accumulation[index]=old+vec4f(radiance,1);
}
