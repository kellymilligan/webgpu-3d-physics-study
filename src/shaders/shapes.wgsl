struct Body { p:vec4f, q:vec4f, shape:vec4f, velocity:vec4f }
fn qRotate(q:vec4f,v:vec3f)->vec3f {return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn qInverseRotate(q:vec4f,v:vec3f)->vec3f {return qRotate(vec4f(-q.xyz,q.w),v);}

// Exact planes for polyhedra. Cylinders are analytic; sphubes use an Lp ball.
fn faceCount(kind:u32)->u32 {
  if(kind==5u){return 4u;}if(kind==6u){return 8u;}return 6u;
}
fn facePlane(shape:vec4f,i:u32)->vec4f {
  let kind=u32(round(shape.x));
  if(kind==5u){
    let normals=array<vec3f,4>(vec3f(1,1,-1),vec3f(1,-1,1),vec3f(-1,1,1),vec3f(-1,-1,-1));
    return vec4f(normals[i]/sqrt(3.),shape.y/3.);
  }
  if(kind==6u){return vec4f(vec3f(select(-1.,1.,(i&1u)!=0u),select(-1.,1.,(i&2u)!=0u),select(-1.,1.,(i&4u)!=0u)),shape.y)/sqrt(3.);}
  var n=vec3f(0);n[i/2u]=select(-1.,1.,(i&1u)!=0u);
  return vec4f(n,shape[1u+i/2u]);
}
fn shapeNormal(p:vec3f,shape:vec4f,epsilon:f32)->vec3f {
  let kind=u32(round(shape.x));
  if(kind==0u){return normalize(p);}
  if(kind==2u){return normalize(sign(p)*pow(abs(p)/shape.y,vec3f(shape.z-1.)));}
  if(kind==3u){return normalize(p-vec3f(0,clamp(p.y,-shape.z,shape.z),0));}
  if(kind==4u){
    // A continuous circular side with flat caps and a sharp, un-beveled rim.
    // Compare surface residuals rather than a tolerance band, so thin bodies
    // and secondary glass rays get the same normal as primary intersections.
    if(abs(abs(p.y)-shape.z)<=abs(length(p.xz)-shape.y)){return vec3f(0,sign(p.y),0);}
    return normalize(vec3f(p.x,0,p.z));
  }
  var best=-1e30;var n=vec3f(0,1,0);
  for(var i=0u;i<faceCount(kind);i++){let plane=facePlane(shape,i);let d=dot(plane.xyz,p)-plane.w;if(d>best){best=d;n=plane.xyz;}}
  return n;
}
struct ShapeHit { t:f32, local:vec3f, normal:vec3f }
fn sphereRoots(o:vec3f,d:vec3f,r:f32)->vec2f {
  let middle=-dot(o,d);let closest=o+middle*d;
  let h=r*r-dot(closest,closest);if(h<0.){return vec2f(-1);}
  let root=sqrt(h);return vec2f(middle-root,middle+root);
}
fn sphubeValue(p:vec3f,exponent:f32)->f32 {return dot(pow(abs(p),vec3f(exponent)),vec3f(1))-1.;}
fn sphubeRoot(o:vec3f,d:vec3f,shape:vec4f,range:vec2f)->f32 {
  let start=max(0.,range.x);let end=range.y;if(end<=1e-6){return -1.;}
  // The Lp ball is convex: along a ray there is one minimum and at most two
  // crossings. Bracket the minimum, then bisect the required entry/exit root.
  // This remains reliable for refraction from inside and grazing rays.
  var lo=start;var hi=end;
  for(var i=0u;i<24u;i++){
    let t=(lo+hi)*.5;let p=(o+d*t)/shape.y;
    let derivative=dot(sign(p)*pow(abs(p),vec3f(shape.z-1.)),d);
    if(derivative<0.){lo=t;}else{hi=t;}
  }
  let minimum=(lo+hi)*.5;
  if(sphubeValue((o+d*minimum)/shape.y,shape.z)>0.){return -1.;}
  let inside=sphubeValue((o+d*start)/shape.y,shape.z)<0.;
  lo=select(start,minimum,inside);hi=select(minimum,end,inside);
  for(var i=0u;i<26u;i++){
    let t=(lo+hi)*.5;let negative=sphubeValue((o+d*t)/shape.y,shape.z)<0.;
    if(negative==inside){lo=t;}else{hi=t;}
  }
  return (lo+hi)*.5;
}
fn intersectShape(origin:vec3f,direction:vec3f,center:vec3f,q:vec4f,shape:vec4f,bound:f32)->ShapeHit {
  let o=qInverseRotate(q,origin-center);let d=normalize(qInverseRotate(q,direction));
  let range=sphereRoots(o,d,bound);if(range.y<=1e-6){return ShapeHit(-1.,vec3f(0),vec3f(0));}
  let kind=u32(round(shape.x));var t=1e30;var normal=vec3f(0);
  // Solve entry AND exit analytically, avoiding surface bands that re-hit
  // an interface on secondary rays or miss thin/grazing geometry.
  if(kind==0u){
    let roots=sphereRoots(o,d,shape.y);
    if(roots.x>1e-6){t=roots.x;}else if(roots.y>1e-6){t=roots.y;}
  }else if(kind==2u){
    t=sphubeRoot(o,d,shape,range);if(t<=1e-6){return ShapeHit(-1.,vec3f(0),vec3f(0));}
  }else if(kind==3u||kind==4u){
    // Both shapes share an exact finite circular side, including inside exits.
    let a=dot(d.xz,d.xz);
    if(a>1e-12){
      let middle=-dot(o.xz,d.xz)/a;let closest=o.xz+middle*d.xz;
      let h=(shape.y*shape.y-dot(closest,closest))/a;
      if(h>=0.){let roots=vec2f(middle-sqrt(h),middle+sqrt(h));
        for(var i=0u;i<2u;i++){let candidate=roots[i];if(candidate>1e-6&&abs(o.y+candidate*d.y)<=shape.z){t=min(t,candidate);}}
      }
    }
    if(kind==3u){
      for(var cap=0u;cap<2u;cap++){
        let sign=select(-1.,1.,cap==1u);let roots=sphereRoots(o-vec3f(0,sign*shape.z,0),d,shape.y);
        for(var i=0u;i<2u;i++){let candidate=roots[i];if(candidate>1e-6&&sign*(o.y+candidate*d.y)>=shape.z){t=min(t,candidate);}}
      }
    }else if(abs(d.y)>1e-12){
      for(var cap=0u;cap<2u;cap++){
        let height=select(-shape.z,shape.z,cap==1u);let candidate=(height-o.y)/d.y;
        let radial=o.xz+candidate*d.xz;
        if(candidate>1e-6&&dot(radial,radial)<=shape.y*shape.y){t=min(t,candidate);}
      }
    }
  }else{
    var near=-1e30;var far=1e30;var nearN=vec3f(0);var farN=vec3f(0);
    for(var i=0u;i<faceCount(kind);i++){
      let plane=facePlane(shape,i);let denominator=dot(plane.xyz,d);let distance=plane.w-dot(plane.xyz,o);
      if(abs(denominator)<1e-8){if(distance<0.){return ShapeHit(-1.,vec3f(0),vec3f(0));}continue;}
      let candidate=distance/denominator;
      if(denominator<0.){if(candidate>near){near=candidate;nearN=plane.xyz;}}
      else if(candidate<far){far=candidate;farN=plane.xyz;}
    }
    if(far>=near){if(near>1e-6){t=near;normal=nearN;}else if(far>1e-6){t=far;normal=farN;}}
  }
  if(t==1e30){return ShapeHit(-1.,vec3f(0),vec3f(0));}
  let p=o+d*t;if(kind==0u||kind==2u||kind==3u||kind==4u){normal=shapeNormal(p,shape,0.);}
  return ShapeHit(t,p,normal);
}
