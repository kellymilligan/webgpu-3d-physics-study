import {Vector3} from 'three';

// The same finite softboxes feed the live renderer and the still integrator.
// Each record is five vec4s, matching StudioLight in studio.wgsl.
export function studioLights(s) {
  const target=new Vector3(0,s.height*.35,0),distance=Math.hypot(s.width,s.height,s.depth)*1.5;
  const length=s.stripLength??24,width=s.stripWidth??4;
  const lights=[
    [0,s.lightElevation,.40,[1,.96,.89],0],
    [105,32,.22,[.86,.93,1],.15],
    [-115,40,.23,[1,.97,.92],-.2],
    [180,80,.15,[.94,.97,1],Math.PI/2],
  ];
  const data=new Float32Array(80);
  lights.forEach(([offset,elevation,weight,color,roll],i)=>{
    const az=(s.lightAzimuth+offset)*Math.PI/180,el=elevation*Math.PI/180;
    const direction=new Vector3(Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az));
    const center=target.clone().addScaledVector(direction,distance),normal=direction.clone().negate();
    const right=new Vector3().crossVectors(normal,new Vector3(0,1,0)).normalize();
    const up=new Vector3().crossVectors(right,normal).normalize();
    const r=right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up,Math.sin(roll));
    const u=up.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right,-Math.sin(roll));
    // Normalize power as size changes, preserving approximate central exposure.
    const radiance=s.lightIntensity*weight*distance*distance/(length*width);
    data.set([...center.toArray(),length*width,...normal.toArray(),0,...r.toArray(),width/2,...u.toArray(),length/2,...color.map(c=>c*radiance),0],i*20);
  });
  return data;
}
