@group(0) @binding(0) var source: texture_depth_2d;
@group(0) @binding(1) var outputDepth: texture_storage_2d<r32float,write>;
@compute @workgroup_size(8,8)
fn reduce(@builtin(global_invocation_id) id: vec3u) {
  if(any(id.xy>=textureDimensions(outputDepth))){return;}
  let size=vec2i(textureDimensions(source));let p=vec2i(id.xy)*2;
  var depth=0.;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let at=p+vec2i(x,y);
    if(any(at>=size)){depth=1.;}else{depth=max(depth,textureLoad(source,at,0));}
  }}
  textureStore(outputDepth,vec2i(id.xy),vec4f(depth));
}
