@group(0) @binding(2) var geometryDepth:texture_depth_2d;
@group(0) @binding(3) var geometryNormal:texture_2d<f32>;
@group(0) @binding(4) var outputAO:texture_storage_2d<r32float,write>;
const PI:f32=3.14159265359;
@compute @workgroup_size(8,8)
fn gtao(@builtin(global_invocation_id) id:vec3u) {
  if(any(id.xy>=textureDimensions(outputAO))){return;}
  let size=vec2i(light.viewport.xy);
  let pixel=min(vec2i(id.xy)*2+vec2i(1),size-1);
  let depth=textureLoad(geometryDepth,pixel,0);
  if(depth>=1. || light.occlusion.x<.5){textureStore(outputAO,vec2i(id.xy),vec4f(1));return;}
  let p=viewPosition(vec2f(pixel)+.5,depth);
  let n=normalize(textureLoad(geometryNormal,pixel,0).xyz);
  let v=normalize(-p);
  let radius=light.occlusion.y;
  let radiusPixels=clamp(radius*camera.projection[1][1]*light.viewport.y*.5/max(.01,-p.z),2.,96.);
  let directions=u32(light.options.x);let steps=u32(light.options.y);
  // Static interleaving avoids temporal trails on thousands of independently moving surfaces.
  let rotation=fract(dot(vec2f(id.xy),vec2f(.754877666,.569840296)))*PI;
  var visibility=0.;
  for(var slice=0u;slice<directions;slice++) {
    let phi=rotation+PI*f32(slice)/f32(directions);
    let screenDirection=vec2f(cos(phi),sin(phi));
    let viewDirection=vec3f(screenDirection.x,-screenDirection.y,0.);
    let tangent=normalize(viewDirection-v*dot(viewDirection,v));
    let axis=normalize(cross(tangent,v));
    let projected=n-axis*dot(n,axis);let projectedLength=length(projected);
    if(projectedLength<.0001){continue;}
    let cosN=clamp(dot(projected/projectedLength,v),-1.,1.);
    let angle=atan2(dot(projected,tangent),dot(projected,v));
    var horizons=vec2f(-1.);
    for(var side=0u;side<2u;side++){
      let signDirection=select(-1.,1.,side==1u);
      for(var step=0u;step<steps;step++){
        let f=(f32(step)+.65)/f32(steps);
        let offset=max(1.,radiusPixels*f*f);
        let at=vec2i(round(vec2f(pixel)+screenDirection*signDirection*offset));
        if(any(at<vec2i(0))||any(at>=size)){continue;}
        let z=textureLoad(geometryDepth,at,0);if(z>=1.){continue;}
        let delta=viewPosition(vec2f(at)+.5,z)-p;
        let distance=length(delta);if(distance<.0001||distance>=radius){continue;}
        // Fade only the outer part of the neighborhood, preserving near-field horizons.
        let fade=1.-smoothstep(radius*.65,radius,distance);
        let horizon=mix(-1.,dot(delta/distance,v),fade);
        horizons[side]=max(horizons[side],horizon);
      }
    }
    let h1=clamp(-acos(clamp(horizons.x,-1.,1.)),angle-PI*.5,angle+PI*.5);
    let h2=clamp(acos(clamp(horizons.y,-1.,1.)),angle-PI*.5,angle+PI*.5);
    // Analytic cosine-weighted integration of the visible arc in each view slice.
    let integral=.25*(2.*cosN-cos(2.*h1-angle)-cos(2.*h2-angle)+2.*(h1+h2)*sin(angle));
    visibility+=projectedLength*integral;
  }
  textureStore(outputAO,vec2i(id.xy),vec4f(clamp(visibility/f32(directions),0.,1.)));
}
