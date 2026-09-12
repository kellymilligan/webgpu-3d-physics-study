@group(0) @binding(2) var geometryDepth:texture_depth_2d;
@group(0) @binding(3) var geometryNormal:texture_2d<f32>;
@group(0) @binding(4) var inputAO:texture_2d<f32>;
@group(0) @binding(5) var outputAO:texture_storage_2d<r32float,write>;
@compute @workgroup_size(8,8)
fn filterAO(@builtin(global_invocation_id) id:vec3u) {
  let size=vec2i(textureDimensions(outputAO));if(any(vec2i(id.xy)>=size)){return;}
  let at=vec2i(id.xy);let pixel=min(at*2+1,vec2i(light.viewport.xy)-1);
  let z=textureLoad(geometryDepth,pixel,0);
  if(z>=1.){textureStore(outputAO,at,vec4f(1));return;}
  let p=viewPosition(vec2f(pixel)+.5,z);let n=textureLoad(geometryNormal,pixel,0).xyz;
  var sum=0.;var weight=0.;
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let q=clamp(at+vec2i(x,y),vec2i(0),size-1);let fp=min(q*2+1,vec2i(light.viewport.xy)-1);
    let qz=textureLoad(geometryDepth,fp,0);if(qz>=1.){continue;}
    let qp=viewPosition(vec2f(fp)+.5,qz);let qn=textureLoad(geometryNormal,fp,0).xyz;
    let spatial=exp(-f32(x*x+y*y)*.6);
    let w=spatial*exp(-abs(qp.z-p.z)/max(.005,light.occlusion.y*.1))*pow(max(0.,dot(n,qn)),8.);
    sum+=textureLoad(inputAO,q,0).x*w;weight+=w;
  }}
  textureStore(outputAO,at,vec4f(sum/max(weight,.00001)));
}
