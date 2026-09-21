@group(0) @binding(2) var geometryDepth:texture_depth_2d;
@group(0) @binding(3) var geometryNormal:texture_2d<f32>;
@group(0) @binding(4) var geometryAlbedo:texture_2d<f32>;
@group(0) @binding(5) var ambientOcclusion:texture_2d<f32>;
@group(0) @binding(6) var shadowDepth:texture_depth_2d;
@group(0) @binding(7) var shadowSampler:sampler_comparison;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
}
// Compare at texel centers against the analytic receiver surface. A constant
// depth across a PCF kernel falsely shadows curved spheres against themselves.
fn shadowVisibility(world:vec3f,n:vec3f,radius:f32)->f32 {
  if(light.shadow.x<.5){return 1.;}
  let position=(light.lightView*vec4f(world,1)).xyz;
  let normal=(light.lightView*vec4f(n,0)).xyz;
  let center=position-normal*radius;
  let clip=light.lightProjection*vec4f(position,1);
  let uv=vec2f(clip.x*.5+.5,.5-clip.y*.5);
  if(any(uv<vec2f(0))||any(uv>vec2f(1))||clip.z<0.||clip.z>1.){return 1.;}
  let offsets=array<vec2f,16>(vec2f(-.942,-.399),vec2f(.946,-.769),vec2f(-.094,-.929),vec2f(.345,.294),vec2f(-.916,.458),vec2f(-.815,-.879),vec2f(-.383,.277),vec2f(.974,.756),vec2f(.443,-.975),vec2f(.537,-.474),vec2f(-.265,-.418),vec2f(.792,.191),vec2f(-.242,.997),vec2f(-.814,.914),vec2f(.200,.786),vec2f(.144,-.141));
  let count=select(16u,1u,light.shadow.y<.01);
  var shadow=0.;
  for(var i=0u;i<count;i++){
    let sampleUV=(floor(uv*light.shadow.w+offsets[i]*light.shadow.y)+.5)/light.shadow.w;
    let xy=(vec2f(sampleUV.x*2.-1.,1.-sampleUV.y*2.)-light.lightProjection[3].xy)/vec2f(light.lightProjection[0].x,light.lightProjection[1].y);
    var z=position.z;
    if(radius>0.){
      let delta=xy-center.xy;let h=radius*radius-dot(delta,delta);
      if(h<=0.){shadow+=1.;continue;}
      z=center.z+sqrt(h);
    }else{
      z=position.z-dot(xy-position.xy,normal.xy)/max(.001,normal.z);
    }
    let reference=(light.lightProjection*vec4f(xy,z+light.shadow.z,1)).z;
    shadow+=textureSampleCompareLevel(shadowDepth,shadowSampler,sampleUV,reference-.000001);
  }
  return shadow/f32(count);
}
fn aoAt(pixel:vec2i,p:vec3f,n:vec3f)->f32 {
  if(light.occlusion.x<.5){return 1.;}
  let halfPosition=(vec2f(pixel)+.5)*.5-.5;let base=vec2i(floor(halfPosition));let f=fract(halfPosition);
  var sum=0.;var weights=0.;let size=vec2i(textureDimensions(ambientOcclusion));
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let at=clamp(base+vec2i(x,y),vec2i(0),size-1);let full=min(at*2+1,vec2i(light.viewport.xy)-1);
    let z=textureLoad(geometryDepth,full,0);if(z>=1.){continue;}
    let q=viewPosition(vec2f(full)+.5,z);let qn=textureLoad(geometryNormal,full,0).xyz;
    let spatial=select(1.-f.x,f.x,x==1)*select(1.-f.y,f.y,y==1);
    let w=spatial*exp(-abs(q.z-p.z)/max(.005,light.occlusion.y*.12))*pow(max(0.,dot(n,qn)),4.);
    sum+=w*textureLoad(ambientOcclusion,at,0).x;weights+=w;
  }}
  let visibility=select(1.,sum/max(weights,.00001),weights>.00001);
  return pow(clamp(visibility,0.,1.),light.occlusion.z);
}
fn schlickGlass(c:f32)->f32 {let f0=pow((light.options.w-1.)/(light.options.w+1.),2.);return f0+(1.-f0)*pow(1.-c,5.);}
fn fresnel(f0:vec3f,cosine:f32)->vec3f {return f0+(1.-f0)*pow(1.-cosine,5.);}
fn srgb(c:vec3f)->vec3f {return select(c*12.92,1.055*pow(c,vec3f(1./2.4))-.055,c>vec3f(.0031308));}
struct StripShading { diffuse:vec3f, specular:vec3f }
fn studioShading(world:vec3f,n:vec3f,v:vec3f,base:vec3f,f0:vec3f,roughness:f32,metallic:f32,shadow:f32,ao:f32)->StripShading {
  var diffuse=vec3f(0);var specular=vec3f(0);let reflection=reflect(-v,n);
  let f=fresnel(f0,max(0.,dot(n,v)));
  for(var i=0u;i<4u;i++){
    let strip=light.strips[i];let visibility=select(ao,shadow,i==0u);
    var irradiance=0.;
    for(var j=0u;j<4u;j++){
      let offset=vec2f(select(-.57735,.57735,(j&1u)!=0u),select(-.57735,.57735,(j&2u)!=0u));
      let diff=strip.center.xyz+strip.right.xyz*(offset.x*strip.right.w)+strip.up.xyz*(offset.y*strip.up.w)-world;
      let distance2=dot(diff,diff);let l=diff*inverseSqrt(distance2);
      irradiance+=max(0.,dot(n,l))*max(0.,dot(strip.normal.xyz,-l))*strip.center.w/(4.*distance2);
    }
    diffuse+=(1.-f)*(1.-metallic)*base/3.14159265*strip.radiance.xyz*irradiance*visibility;
    let denominator=dot(reflection,strip.normal.xyz);
    if(denominator<-.00001){
      let t=dot(strip.center.xyz-world,strip.normal.xyz)/denominator;
      if(t>0.){
        let p=world+reflection*t-strip.center.xyz;
        let uv=vec2f(dot(p,strip.right.xyz),dot(p,strip.up.xyz));let extent=vec2f(strip.right.w,strip.up.w);
        let blur=max(.015,t*roughness*roughness*1.5);
        let coverage=(atan((extent-uv)/blur)-atan((-extent-uv)/blur))/3.14159265;
        specular+=strip.radiance.xyz*f*coverage.x*coverage.y*(1.-roughness*.35)*visibility;
      }
    }
  }
  return StripShading(diffuse,specular);
}
@fragment fn fragment(@builtin(position) screen:vec4f)->@location(0) vec4f {
  let pixel=vec2i(screen.xy);let depth=textureLoad(geometryDepth,pixel,0);
  let blackStudio=camera.style.x>4.5;
  if(depth>=1.){return vec4f(select(vec3f(.073,.082,.095),vec3f(0),blackStudio),1);}
  let p=viewPosition(screen.xy,depth);let nv=normalize(textureLoad(geometryNormal,pixel,0).xyz);
  let world=(camera.inverse*vec4f(p,1)).xyz;let n=normalize((camera.inverse*vec4f(nv,0)).xyz);
  let albedo=textureLoad(geometryAlbedo,pixel,0);var base=albedo.rgb;
  let kind=i32(round(albedo.a*10.))-1;let sphere=kind>=0;
  var roughness=select(.85,light.ambient.y,sphere);var metallic=select(0.,light.ambient.z,sphere);
  if(kind==8){roughness=.16;metallic=0.;}
  if(kind==1){roughness=.82;metallic=0.;}if(kind==2){base=vec3f(.93,.94,.96);roughness=.055;metallic=1.;}
  if(glassKind(u32(max(0,kind)))){roughness=max(.06,glassFrost(u32(kind),light.theme.y));metallic=0.;}
  let v=normalize(camera.eye.xyz-world);let l=light.direction.xyz;let h=normalize(v+l);
  let noV=max(.001,dot(n,v));let noL=max(0.,dot(n,l));let noH=max(0.,dot(n,h));let voH=max(0.,dot(v,h));
  var f0=mix(vec3f(.04),base,metallic);if(glassKind(u32(max(0,kind)))){f0=vec3f(schlickGlass(1.));}let f=fresnel(f0,voH);
  let alpha=roughness*roughness;let a2=alpha*alpha;
  let denominator=noH*noH*(a2-1.)+1.;
  let distribution=a2/max(.0000001,3.14159265*denominator*denominator);
  let gv=noL*sqrt(noV*noV*(1.-a2)+a2);let gl=noV*sqrt(noL*noL*(1.-a2)+a2);
  let visibility=.5/max(.00001,gv+gl);
  let specular=distribution*visibility*f;
  let diffuse=(1.-f)*(1.-metallic)*base/3.14159265;
  let shadow=shadowVisibility(world,n,textureLoad(geometryNormal,pixel,0).w);
  let direct=(diffuse+specular)*vec3f(1.,.96,.89)*light.direction.w*noL*shadow;
  let ao=aoAt(pixel,p,nv);
  // A broad analytic studio environment, not local bounce or scene reflections.
  let ambientColor=select(mix(vec3f(.19,.17,.14),vec3f(.57,.64,.75),n.y*.5+.5),vec3f(0),blackStudio);
  let environmentDirection=normalize(mix(reflect(-v,n),n,roughness*roughness));
  let environment=select(mix(vec3f(.16,.14,.11),vec3f(.57,.64,.75),environmentDirection.y*.5+.5),vec3f(0),blackStudio);
  let ambientF=fresnel(f0,noV);
  let indirect=((1.-ambientF)*(1.-metallic)*base*ambientColor+environment*ambientF*(1.-roughness*.45))*light.ambient.x*ao;
  var studio=StripShading(vec3f(0),vec3f(0));
  if(light.theme.z>.5){studio=studioShading(world,n,v,base,f0,roughness,metallic,shadow,ao);}
  var color=(select(direct,studio.diffuse+studio.specular,light.theme.z>.5)+indirect)*light.ambient.w;
  if(glassKind(u32(max(0,kind)))){
    // Fast glass appearance for composition; the still renderer traces actual
    // transmission through the complete scene, including hidden spheres.
    let fGlass=schlickGlass(noV);
    let transmitted=mix(vec3f(.12,.14,.16),vec3f(.55,.63,.72),mix(clamp(-n.y*.5+.5,0.,1.),.7,roughness))*mix(vec3f(1),base,light.occlusion.w);
    color=(environment*fGlass+transmitted*(1.-fGlass)*light.ambient.x+select(specular*light.direction.w*noL*shadow,studio.specular,light.theme.z>.5))*light.ambient.w;
  }
  if(blackStudio&&glassKind(u32(max(0,kind)))){
    // Neutral frosted transmission approximation; the still integrator traces
    // actual transmission and local emitter lighting against the black world.
    let reflection=select(specular*light.direction.w*noL*shadow,studio.specular,light.theme.z>.5);
    let fill=select(diffuse*vec3f(1.,.96,.89)*light.direction.w*noL*shadow,studio.diffuse,light.theme.z>.5);
    color=(reflection+fill*roughness*.35)*light.ambient.w;
  }
  if(kind==4){color=warmGlow()*light.theme.x*light.ambient.w;}
  color=clamp((color*(2.51*color+.03))/(color*(2.43*color+.59)+.14),vec3f(0),vec3f(1));
  if(light.options.z>.5&&light.options.z<1.5){return vec4f(vec3f(ao),1);}
  if(light.options.z>1.5&&light.options.z<2.5){return vec4f(vec3f(shadow),1);}
  if(light.options.z>2.5){return vec4f(n*.5+.5,1);}
  return vec4f(srgb(color),1);
}
