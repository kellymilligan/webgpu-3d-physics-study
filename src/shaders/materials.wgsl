fn materialHash(value:u32)->u32 {var x=value;x=((x>>16u)^x)*0x45d9f3bu;x=((x>>16u)^x)*0x45d9f3bu;return (x>>16u)^x;}
// 0 uniform, 1 matte ceramic, 2 chrome, 3 glass. IDs survive BVH sorting/culling.
fn materialKind(id:u32,packed:f32)->u32 {
  let code=u32(packed);if(code==0u){return 0u;}
  let glass=f32((code>>1u)&127u)*.01;let chrome=f32((code>>8u)&127u)*.01;
  let q=f32(materialHash(id)&65535u)/65536.;let total=max(1.,glass+chrome);
  if(q<glass/total){return 3u;}if(q<(glass+chrome)/total){return 2u;}return 1u;
}
fn paletteColor(i:u32,palette:f32)->vec3f {
  if(palette>2.5){
    // Bright candy colors in linear RGB, shared by the live and still renderers.
    let sprinkles=array<vec3f,8>(
      vec3f(1.,.018,.22), vec3f(1.,.72,.012),
      vec3f(.025,.9,.28), vec3f(.015,.38,1.),
      vec3f(.5,.075,1.), vec3f(1.,.18,.018),
      vec3f(1.,.2,.43), vec3f(.018,.85,.72));
    return sprinkles[materialHash(i^0xabc123u)%8u];
  }
  let colors=array<vec3f,8>(vec3f(.63,.74,.40),vec3f(.85,.64,.39),vec3f(.39,.60,.65),vec3f(.72,.76,.57),vec3f(.73,.42,.28),vec3f(.43,.54,.38),vec3f(.75,.72,.62),vec3f(.39,.45,.52));
  if(palette>1.5){return vec3f(.62,.69,.77);}
  if(palette>.5){return mix(vec3f(.17,.36,.47),vec3f(.63,.87,.82),f32((i*1664525u+1013904223u)%256u)/255.);}
  return colors[(i*1664525u+1013904223u)%8u];
}
