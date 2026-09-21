fn materialHash(value:u32)->u32 {var x=value;x=((x>>16u)^x)*0x45d9f3bu;x=((x>>16u)^x)*0x45d9f3bu;return (x>>16u)^x;}
// 0 uniform, 1 matte ceramic, 2 chrome, 3 clear glass, 4 emitter, 5–7 frosted glass, 8 glossy ceramic. IDs survive BVH sorting/culling.
fn materialKind(id:u32,packed:f32)->u32 {
  let code=u32(packed);
  if((code&131072u)!=0u){
    if(forestCategory(id)>=.98){return 4u;}
    return 5u+materialHash(id^0x198bc325u)%3u;
  }
  if((code&65536u)!=0u){
    let q=forestCategory(id);
    if(q<.60){return 8u;}
    if(q<.80){let level=materialHash(id^0x198bc325u)%4u;return select(4u+level,3u,level==0u);}
    if(q<.98){return 8u;}
    return 4u;
  }
  if(code==0u){return 0u;}
  let glass=f32((code>>1u)&127u)*.01;let chrome=f32((code>>8u)&127u)*.01;
  let q=f32(materialHash(id)&65535u)/65536.;let total=max(1.,glass+chrome);
  if(q<glass/total){return 3u;}if(q<(glass+chrome)/total){return 2u;}return 1u;
}
fn paletteColor(i:u32,palette:f32)->vec3f {
  if(palette>4.5){return select(vec3f(.98),warmGlow(),forestCategory(i)>=.98);}
  if(palette>3.5){
    let q=forestCategory(i);let index=materialHash(i^0xb3917c53u);
    if(q<.60||(q>=.95&&q<.98)){
      let darks=array<vec3f,5>(vec3f(.003,.003,.003),vec3f(.011,.011,.011),vec3f(.006,.012,.008),vec3f(.012,.008,.006),vec3f(.004,.009,.005));
      return darks[index%5u];
    }
    if(q<.80){return vec3f(.9,.97,.92);}
    if(q<.95){
      let greens=array<vec3f,7>(vec3f(.008,.035,.019),vec3f(.014,.07,.028),vec3f(.025,.12,.046),vec3f(.055,.22,.08),vec3f(.075,.085,.018),vec3f(.14,.17,.038),vec3f(.04,.07,.023));
      return greens[index%7u];
    }
    return warmGlow();
  }
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

// Forest Glow uses a coordinated material mix, selected by the high packed bit.
fn forestCategory(id:u32)->f32 {return f32(materialHash(id^0x63b74a91u)&65535u)/65536.;}
fn glassKind(kind:u32)->bool {return kind==3u||(kind>=5u&&kind<=7u);}
fn glassFrost(kind:u32,maximum:f32)->f32 {
  if(kind<5u||kind>7u){return 0.;}return maximum*f32(kind-4u)/3.;
}
fn warmGlow()->vec3f {return vec3f(1.,.82,.6);}
