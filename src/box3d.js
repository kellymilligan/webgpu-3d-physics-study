import createModule from './vendor/box3d.js';

export const bodyTypes = [
  ['Sphere','sphere'],['Cube','cube'],['Sphube','sphube'],['Capsule','capsule'],
  ['Cylinder','cylinder'],['Tetrahedron','tetrahedron'],['Octahedron','octahedron'],['Box','box'],
];

export function typeMask(settings) {
  return bodyTypes.reduce((mask,[,key],index)=>mask|(settings[`shape_${key}`]?1<<index:0),0);
}

export class Box3DPhysics {
  static async create() {
    const url=`${import.meta.env.BASE_URL}box3d.wasm`;
    return new Box3DPhysics(await createModule({locateFile:()=>url}));
  }
  constructor(module){this.module=module;this.count=0;this.lastConfig='';}
  reset(s) {
    const mask=typeMask(s);if(!mask)throw new Error('Select at least one body type.');
    const count=this.module._lab_create(s.count,s.width,s.height,s.depth,s.radius,s.variation,s.variationBias,s.seed,mask,s.mass,s.friction,s.restitution,s.damping);
    if(count===-1)throw new Error('Bodies do not fit without overlap. Reduce count or size, use Fit base size, or enlarge the container.');
    if(count!==s.count)throw new Error('Box3D could not create the requested bodies.');
    this.count=count;this.lastConfig='';return this.state();
  }
  configure(s) {
    const key=[s.gravity,s.mass,s.friction,s.restitution,s.damping].join('/');
    if(key===this.lastConfig)return;this.lastConfig=key;
    this.module._lab_config(s.gravity,s.mass,s.friction,s.restitution,s.damping);
  }
  step(s,cursor,steps=1) {
    this.configure(s);const dt=1/60;
    for(let i=0;i<steps;i++){
      this.module._lab_cursor(...cursor.position,s.cursorRadius,cursor.active?1:0,dt/Math.max(.1,s.cursorStrength));
      this.module._lab_step(dt,s.substeps);
    }
    return this.state();
  }
  state(count=this.count) {
    const length=Math.min(count,this.count)*16,ptr=this.module._lab_state()>>>2;
    return this.module.HEAPF32.slice(ptr,ptr+length);
  }
  destroy(){this.module._lab_destroy();this.count=0;}
}
