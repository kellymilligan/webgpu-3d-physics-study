struct Particle { p: vec4f, v: vec4f, w: vec4f }
struct Params {
  box: vec4f, // half width, height, half depth, cell size
  grid: vec4u, // xyz dimensions, particle count
  physics: vec4f, // dt, gravity, restitution, friction
  motion: vec4f, // damping, base radius, base mass, correction relaxation
  cursor: vec4f,
  cursorVelocity: vec4f, // xyz velocity, force scale
}
@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var<storage, read_write> a: array<Particle>;
@group(0) @binding(2) var<storage, read_write> b: array<Particle>;
@group(0) @binding(3) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> next: array<u32>;
fn cell(p: vec3f) -> vec3i {
  return clamp(vec3i(floor((p+vec3f(u.box.x,0,u.box.z))/u.box.w)),vec3i(0),vec3i(u.grid.xyz)-1);
}
fn key(c: vec3i) -> u32 { return u32(c.x)+u.grid.x*(u32(c.y)+u.grid.y*u32(c.z)); }
fn limit(v: vec3f, m: f32) -> vec3f { return v * min(1.,m/max(length(v),0.000001)); }
@compute @workgroup_size(128)
fn integrate(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x; if(i>=u.grid.w){return;}
  var q=a[i];
  q.v.w=1./(u.motion.z*pow(q.p.w/u.motion.y,3.));
  q.v=vec4f(limit((q.v.xyz+vec3f(0,-u.physics.y*u.physics.x,0))*exp(-u.motion.x*u.physics.x),q.p.w*.8/u.physics.x),q.v.w);
  q.p=vec4f(q.p.xyz+q.v.xyz*u.physics.x,q.p.w);
  q.w=vec4f(q.w.xyz*exp(-u.motion.x*u.physics.x),0);
  a[i]=q;
}
@compute @workgroup_size(128)
fn buildGrid(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;if(i>=u.grid.w){return;}
  next[i]=atomicExchange(&heads[key(cell(a[i].p.xyz))],i+1u);
}
@compute @workgroup_size(128)
fn solve(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;if(i>=u.grid.w){return;}
  let q=a[i];let p=q.p.xyz;let r=q.p.w;let inv=q.v.w;
  var dp=vec3f(0);var dv=vec3f(0);var dw=vec3f(0);var contacts=0.;
  let c=cell(p);
  // Each list is built in a separate dispatch. No fixed cell capacity or dropped contacts.
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let nc=c+vec3i(x,y,z);
    if(any(nc<vec3i(0)) || any(nc>=vec3i(u.grid.xyz))){continue;}
    var entry=atomicLoad(&heads[key(nc)]);
    loop {
      if(entry==0u){break;}
      let j=entry-1u;entry=next[j];if(j==i){continue;}
      let other=a[j];let delta=p-other.p.xyz;let rr=r+other.p.w;let d2=dot(delta,delta);
      if(d2>=rr*rr){continue;}
      let d=sqrt(max(d2,1e-12));
      var n=delta/d;if(d2<1e-12){n=vec3f(select(-1.,1.,i>j),0,0);}
      let penetration=rr-d;let share=inv/(inv+other.v.w);
      dp+=n*penetration*share;
      let relative=q.v.xyz-other.v.xyz+cross(q.w.xyz,-r*n)-cross(other.w.xyz,other.p.w*n);
      let vn=dot(relative,n);
      let bounce=select(0.,u.physics.z,vn < -0.5);
      let jn=max(0.,-(1.+bounce)*vn)/(inv+other.v.w);
      let tangent=relative-vn*n;
      let jt=-limit(tangent/((inv+other.v.w)*3.5),u.physics.w*max(jn,penetration*.15/(u.physics.x*(inv+other.v.w))));
      dv+=(n*(bounce*max(0.,-vn)/(inv+other.v.w))+jt)*inv;
      dw+=cross(-r*n,jt)*(2.5*inv/(r*r));
      contacts+=1.;
    }
  }}}
  let relax=u.motion.w/max(1.,contacts*.35);
  let correction=limit(dp*relax,r*.35);
  var pos=p+correction;
  var vel=q.v.xyz+correction/u.physics.x+dv*relax;
  var omega=q.w.xyz+dw*relax;
  if(u.cursor.w>0.) {
    let d=pos-u.cursor.xyz;let dist=length(d);let rr=r+u.cursor.w;
    if(dist<rr) {
      let n=select(vec3f(0,1,0),d/max(dist,1e-8),dist>1e-8);
      pos+=n*min(rr-dist,r*1.5);
      let rel=vel-u.cursorVelocity.xyz;
      vel+=n*(max(0.,-dot(rel,n)) + min((rr-dist)/u.physics.x,12.))*u.cursorVelocity.w;
      vel-=limit(rel-dot(rel,n)*n,u.physics.w*max(0.,-dot(rel,n)))*.5;
    }
  }
  let low=vec3f(-u.box.x+r,r,-u.box.z+r);let high=vec3f(u.box.x-r,u.box.y-r,u.box.z-r);
  for(var axis=0u;axis<3u;axis++){
    if(pos[axis]<low[axis] || pos[axis]>high[axis]){
      var n=vec3f(0);n[axis]=select(-1.,1.,pos[axis]<low[axis]);
      pos[axis]=clamp(pos[axis],low[axis],high[axis]);
      let vn=dot(vel,n);
      if(vn<0.) {
        let bounce=select(0.,u.physics.z,vn < -0.5);
        let impulse=-(1.+bounce)*vn;
        vel+=n*impulse;
        let relative=vel+cross(omega,-r*n);
        let tangent=relative-n*dot(relative,n);
        let friction=-limit(tangent/3.5,u.physics.w*impulse);
        vel+=friction;omega+=cross(-r*n,friction)*2.5/(r*r);
      }
    }
  }
  b[i]=Particle(vec4f(pos,r),vec4f(vel,inv),vec4f(omega,0));
}
