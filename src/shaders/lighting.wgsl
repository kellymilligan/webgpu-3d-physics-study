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
fn fresnel(f0:vec3f,cosine:f32)->vec3f {return f0+(1.-f0)*pow(1.-cosine,5.);}
fn srgb(c:vec3f)->vec3f {return select(c*12.92,1.055*pow(c,vec3f(1./2.4))-.055,c>vec3f(.0031308));}
@fragment fn fragment(@builtin(position) screen:vec4f)->@location(0) vec4f {
  let pixel=vec2i(screen.xy);let depth=textureLoad(geometryDepth,pixel,0);
  if(depth>=1.){return vec4f(.073,.082,.095,1);}
  let p=viewPosition(screen.xy,depth);let nv=normalize(textureLoad(geometryNormal,pixel,0).xyz);
  let world=(camera.inverse*vec4f(p,1)).xyz;let n=normalize((camera.inverse*vec4f(nv,0)).xyz);
  let albedo=textureLoad(geometryAlbedo,pixel,0);let base=albedo.rgb;
  let roughness=select(.85,light.ambient.y,albedo.a>.5);let metallic=select(0.,light.ambient.z,albedo.a>.5);
  let v=normalize(camera.eye.xyz-world);let l=light.direction.xyz;let h=normalize(v+l);
  let noV=max(.001,dot(n,v));let noL=max(0.,dot(n,l));let noH=max(0.,dot(n,h));let voH=max(0.,dot(v,h));
  let f0=mix(vec3f(.04),base,metallic);let f=fresnel(f0,voH);
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
  let ambientColor=mix(vec3f(.19,.17,.14),vec3f(.57,.64,.75),n.y*.5+.5);
  let environmentDirection=normalize(mix(reflect(-v,n),n,roughness*roughness));
  let environment=mix(vec3f(.16,.14,.11),vec3f(.57,.64,.75),environmentDirection.y*.5+.5);
  let ambientF=fresnel(f0,noV);
  let indirect=((1.-ambientF)*(1.-metallic)*base*ambientColor+environment*ambientF*(1.-roughness*.45))*light.ambient.x*ao;
  var color=(direct+indirect)*light.ambient.w;
  color=clamp((color*(2.51*color+.03))/(color*(2.43*color+.59)+.14),vec3f(0),vec3f(1));
  if(light.options.z>.5&&light.options.z<1.5){return vec4f(vec3f(ao),1);}
  if(light.options.z>1.5&&light.options.z<2.5){return vec4f(vec3f(shadow),1);}
  if(light.options.z>2.5){return vec4f(n*.5+.5,1);}
  return vec4f(srgb(color),1);
}
