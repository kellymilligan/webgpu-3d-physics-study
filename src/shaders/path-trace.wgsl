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
  theme:vec4f, // sphere emission strength, maximum glass roughness, studio rig enabled, unused
  strips:array<StudioLight,4>,
}
struct Node { lo:vec3f, a:u32, hi:vec3f, b:u32 }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> bodies:array<Body>;
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
        let id=indices[node.a+j];let body=bodies[id];let shapeHit=intersectShape(origin,direction,body.p.xyz,body.q,body.shape,body.p.w);
        if(shapeHit.t>.000001&&shapeHit.t<hit.t){hit=Hit(shapeHit.t,id);}
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
fn environment(d:vec3f)->vec3f {if(params.box.w>4.5){return vec3f(0); }return mix(vec3f(.16,.14,.11),vec3f(.57,.64,.75),d.y*.5+.5)*params.environment.x;}
fn power(a:f32,b:f32)->f32 {let aa=a*a;return aa/max(1e-20,aa+b*b);}
fn diskPDF(origin:vec3f,direction:vec3f,t:f32)->f32 {
  return t*t/max(1e-12,PI*params.lightCenter.w*params.lightCenter.w*abs(dot(params.lightNormal.xyz,direction)));
}
// Uniform selection among the four finite panels; selection probability is
// included in both next-event sampling and the BSDF-hit MIS density.
fn areaHit(origin:vec3f,direction:vec3f)->Hit {
  if(params.theme.z<.5){return Hit(diskDistance(origin,direction),0u);}
  var hit=Hit(INF,MISS);
  for(var i=0u;i<4u;i++){let t=stripDistance(params.strips[i],origin,direction);if(t<hit.t){hit=Hit(t,i);}}
  return hit;
}
fn areaPDF(origin:vec3f,direction:vec3f,t:f32,id:u32)->f32 {
  if(params.theme.z<.5){return diskPDF(origin,direction,t);}
  let strip=params.strips[id];
  return .25*t*t/max(1e-12,strip.center.w*abs(dot(strip.normal.xyz,direction)));
}
fn areaEmission(id:u32,direction:vec3f)->vec3f {
  if(params.theme.z<.5){return emission();}
  let strip=params.strips[id];return select(vec3f(0),strip.radiance.xyz,dot(strip.normal.xyz,direction)<0.);
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
// Isotropic GGX visible-normal sampling for a rough dielectric interface.
// Sample the microfacet normal facing the incident direction, then Fresnel-select
// reflection/transmission. The BSDF/PDF ratio reduces to Smith G/G1 (and eta²).
fn visibleMicroNormal(n:vec3f,v:vec3f,alpha:f32)->vec3f {
  let frame=basis(n);let local=transpose(frame)*v;
  let stretched=normalize(vec3f(local.xy*alpha,local.z));
  var tangent=vec3f(1,0,0);if(stretched.z<.99999){tangent=normalize(cross(vec3f(0,0,1),stretched));}
  let second=cross(stretched,tangent);let radius=sqrt(random());let angle=2.*PI*random();
  let x=radius*cos(angle);let y=mix(sqrt(max(0.,1.-x*x)),radius*sin(angle),(1.+stretched.z)*.5);
  let h=tangent*x+second*y+stretched*sqrt(max(0.,1.-x*x-y*y));
  return frame*normalize(vec3f(alpha*h.xy,max(.000001,h.z)));
}
fn smithLambda(cosine:f32,alpha:f32)->f32 {
  let c2=max(.00000001,cosine*cosine);return .5*(sqrt(1.+alpha*alpha*(1.-c2)/c2)-1.);
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
    let area=areaHit(origin,direction);let hit=trace(origin,direction,area.t);
    if(hit.id==MISS){
      if(area.t!=INF){let weight=select(power(previousPdf,.5*areaPDF(previousOrigin,direction,area.t,area.id)),1.,deltaEvent);radiance+=throughput*exp(-absorption*area.t)*areaEmission(area.id,direction)*weight;}
      else{let envPDF=select(0.,.5/(2.*PI),dot(previousNormal,direction)>0.);let weight=select(power(previousPdf,envPDF),1.,deltaEvent);radiance+=throughput*environment(direction)*weight;}
      break;
    }
    throughput*=exp(-absorption*hit.t);
    let point=origin+direction*hit.t;var outward=vec3f(0,1,0);var radius=1.;var kind=1u;var base=select(vec3f(.14,.155,.17),vec3f(.004),params.box.w>4.5);var roughness=.85;var metallic=0.;
    if(hit.id!=FLOOR){
      let body=bodies[hit.id];radius=body.p.w;let local=qInverseRotate(body.q,point-body.p.xyz);outward=qRotate(body.q,shapeNormal(local,body.shape,max(.00002,radius*.00025)));kind=materialKind(hit.id,params.material.x);base=paletteColor(hit.id,params.box.w);
      roughness=params.material.y;metallic=params.material.z;
      if(kind==8u){roughness=.16;metallic=0.;}
      if(kind==1u){roughness=.82;metallic=0.;}if(kind==2u){base=vec3f(.93,.94,.96);roughness=.055;metallic=1.;}
    }
    if(kind==4u){
      // Sphere emitters are sampled by continuing BSDF paths, not by the panel/
      // environment NEE strategy, so their emission receives no competing MIS PDF.
      radiance+=throughput*warmGlow()*params.theme.x;roughness=.82;metallic=0.;
    }
    let entering=dot(direction,outward)<0.;let n=select(-outward,outward,entering);let v=-direction;
    // Keep offsets resolvable at world scale without skipping thin geometry.
    let epsilon=max(.000004,max(abs(point.x),max(abs(point.y),abs(point.z)))*.000001);
    previousOrigin=point;previousNormal=n;
    if(glassKind(kind)){
      let frost=glassFrost(kind,params.theme.y);let alpha=frost*frost;
      var micro=n;if(frost>.001){micro=visibleMicroNormal(n,v,alpha);}
      let eta=select(1./params.material.w,params.material.w,entering);let f=dielectric(clamp(dot(micro,v),0.,1.),eta);
      if(random()<f){
        direction=reflect(direction,micro);if(dot(direction,n)<=0.){break;}
      }else{
        direction=refract(direction,micro,1./eta);
        if(dot(direction,direction)<.000001||dot(direction,n)>=0.){break;}
        direction=normalize(direction);throughput/=eta*eta;
        if(entering){absorption=-log(mix(vec3f(1),max(base,vec3f(.05)),params.environment.z))/max(.001,2.*radius);}
        else{absorption=vec3f(0);}
      }
      if(frost>.001){let lv=smithLambda(dot(n,v),alpha);let ll=smithLambda(dot(n,direction),alpha);throughput*=(1.+lv)/(1.+lv+ll);}
      // No next-event estimator is used at dielectric vertices (including rough
      // glass), so subsequent light hits must retain their full BSDF weight.
      deltaEvent=true;previousPdf=0.;
    }else{
      // Next-event estimation: choose an area-light sample or a cosine-independent
      // hemisphere environment sample, then combine with BSDF paths using MIS.
      var lightDirection=vec3f(0);var lightDistance=INF;var incoming=vec3f(0);var lightPdf=0.;
      if(random()<.5){
        var lightPoint=vec3f(0);var lightID=0u;
        if(params.theme.z>.5){
          lightID=min(3u,u32(random()*4.));let strip=params.strips[lightID];
          lightPoint=strip.center.xyz+strip.right.xyz*((random()*2.-1.)*strip.right.w)+strip.up.xyz*((random()*2.-1.)*strip.up.w);
        }else{
          let r=params.lightCenter.w*sqrt(random());let phi=2.*PI*random();
          lightPoint=params.lightCenter.xyz+params.lightRight.xyz*(r*cos(phi))+params.lightUp.xyz*(r*sin(phi));
        }
        let diff=lightPoint-point;lightDistance=length(diff);lightDirection=diff/lightDistance;
        lightPdf=.5*areaPDF(point,lightDirection,lightDistance,lightID);incoming=areaEmission(lightID,lightDirection);
        if(areaHit(point+n*epsilon,lightDirection).t<lightDistance-epsilon*2.){incoming=vec3f(0);}
      }else{
        let z=random();let phi=2.*PI*random();lightDirection=basis(n)*vec3f(sqrt(1.-z*z)*cos(phi),sqrt(1.-z*z)*sin(phi),z);
        lightPdf=.5/(2.*PI);incoming=environment(lightDirection);
        // Panels are opaque, including their non-emitting backs.
        if(areaHit(point+n*epsilon,lightDirection).t!=INF){incoming=vec3f(0);}
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
