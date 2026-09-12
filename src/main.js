import { PerspectiveCamera, Vector3, Matrix4, WebGPUCoordinateSystem, Raycaster, Plane } from 'three';
import { Pane } from 'tweakpane';
import { GPUWorld } from './gpu.js';
import { defaults, counts, fitRadius, layout } from './config.js';
import './style.css';

const canvas=document.querySelector('#stage');
const settings={...defaults};
settings.radius=fitRadius(settings);
const stats={state:'Starting WebGPU…',fps:'—',gpu:'—',memory:'—',actual:'—',visible:'—',physics:'—',render:'—',shadow:'—',ao:'—',lighting:'—'};
const pane=new Pane({container:document.querySelector('#gui'),title:'Controls'});
let world, busy=false, stopped=false, worker, generation=0, rebuildTimer;
let syncingGui=false,cancelSeed=null,uploadChain=Promise.resolve();
function refreshGui(){syncingGui=true;try{pane.refresh();}finally{syncingGui=false;}}
let cameraDirty=true,last=performance.now(),accumulator=0,frameCount=0,frameElapsed=0,framePending=false,stepping=false;
const errors=[];
const camera=new PerspectiveCamera(42,1,.01,1000);camera.coordinateSystem=WebGPUCoordinateSystem;
const raycaster=new Raycaster();
const orbit={yaw:.42,pitch:.38,distance:48,target:new Vector3(0,5,0)};
const cursor={active:false,position:[0,5,0],velocity:[0,0,0]};
let pointer=null, lastCursor=null, lastCursorTime=0;
const cameraData=new Float32Array(64);
const palette={Mineral:0,Tidal:1,Silver:2};
const monitor=pane.addBinding(stats,'state',{label:'',readonly:true});
const spheres=pane.addFolder({title:'Spheres'});
spheres.addBinding(settings,'count',{label:'Count',options:counts}).on('change',e=>{if(e.last&&!syncingGui){settings.radius=fitRadius(settings);scheduleReset();}});
spheres.addBinding(settings,'radius',{label:'Radius',min:.005,max:.75,step:.001}).on('change',e=>{if(e.last&&!syncingGui)scheduleReset();});
spheres.addBinding(settings,'variation',{label:'Radius variation',min:0,max:1,step:.01}).on('change',e=>{if(e.last&&!syncingGui){settings.radius=fitRadius(settings);scheduleReset();}});
spheres.addButton({title:'Fit radius to box'}).on('click',()=>{settings.radius=fitRadius(settings);scheduleReset();});
const box=pane.addFolder({title:'Container',expanded:false});
for(const key of ['width','height','depth'])box.addBinding(settings,key,{label:key[0].toUpperCase()+key.slice(1),min:4,max:60,step:.5}).on('change',e=>{if(e.last&&!syncingGui){if(layout(settings).capacity<settings.count)settings.radius=fitRadius(settings);scheduleReset();}});
const physics=pane.addFolder({title:'Physics',expanded:false});
for(const [key,label,min,max,step] of [['gravity','Gravity',0,30,.1],['restitution','Restitution',0,1,.01],['friction','Friction',0,1.5,.01],['mass','Base mass',.05,10,.05],['damping','Air damping',0,3,.01]])physics.addBinding(settings,key,{label,min,max,step});
const lighting=pane.addFolder({title:'Lighting',expanded:true});
for(const [key,label,min,max,step] of [['lightAzimuth','Direction',-180,180,1],['lightElevation','Elevation',10,85,1],['lightIntensity','Light intensity',0,8,.1],['ambientStrength','Ambient',0,2,.05],['exposure','Exposure',.2,2.5,.05]])lighting.addBinding(settings,key,{label,min,max,step});
const shadows=pane.addFolder({title:'Shadows',expanded:false});
shadows.addBinding(settings,'shadows',{label:'Enabled'});
shadows.addBinding(settings,'shadowSoftness',{label:'Softness',min:0,max:8,step:.25});
shadows.addBinding(settings,'shadowResolution',{label:'Resolution',options:{'1024':1024,'2048':2048,'4096':4096}});
const occlusion=pane.addFolder({title:'Contact occlusion',expanded:false});
occlusion.addBinding(settings,'ao',{label:'Enabled'});
occlusion.addBinding(settings,'aoRadius',{label:'Radius',min:.05,max:3,step:.05});
occlusion.addBinding(settings,'aoStrength',{label:'Strength',min:0,max:3,step:.05});
occlusion.addBinding(settings,'aoQuality',{label:'Quality',options:{Fast:0,Balanced:1,High:2}});
const material=pane.addFolder({title:'Material',expanded:false});
material.addBinding(settings,'roughness',{label:'Roughness',min:.06,max:1,step:.01});
material.addBinding(settings,'metallic',{label:'Metallic',min:0,max:1,step:.01});
material.addBinding(settings,'debugLighting',{label:'View',options:{Lit:0,'Occlusion only':1,'Shadows only':2,Normals:3}});
const solver=pane.addFolder({title:'Solver & rendering',expanded:false});
solver.addBinding(settings,'substeps',{label:'Substeps',min:1,max:8,step:1});
solver.addBinding(settings,'iterations',{label:'Contact passes',min:1,max:6,step:1});
solver.addBinding(settings,'timeScale',{label:'Time scale',min:.1,max:2,step:.1});
solver.addBinding(settings,'culling',{label:'Cull hidden'});
solver.addBinding(settings,'pixelRatio',{label:'Pixel ratio',min:.5,max:2,step:.25}).on('change',resize);
solver.addBinding(settings,'color',{label:'Palette',options:palette});
// Tweakpane options use their values as model values, keep the model numeric.
settings.color=0;
const mouse=pane.addFolder({title:'Cursor',expanded:false});
mouse.addBinding(settings,'cursorRadius',{label:'Radius',min:.2,max:5,step:.1});
mouse.addBinding(settings,'cursorStrength',{label:'Strength',min:.1,max:2,step:.1});
mouse.addBinding(settings,'cursorDepth',{label:'Depth',min:0,max:1,step:.01}).on('change',()=>{if(pointer?.button===0)updateCursor(pointer.x,pointer.y);});
const help={stir:'Left drag / touch',orbit:'Right drag / Alt drag',zoom:'Wheel / trackpad',depth:'Shift + wheel'};
for(const key of Object.keys(help))mouse.addBinding(help,key,{readonly:true,label:key[0].toUpperCase()+key.slice(1)});
const performanceFolder=pane.addFolder({title:'Performance',expanded:false});
for(const [key,label] of [['actual','Spheres'],['visible','Drawn'],['physics','Physics'],['render','Render + cull'],['shadow','Shadow span'],['ao','AO span'],['lighting','Lighting span'],['fps','FPS'],['gpu','GPU / frame'],['memory','GPU buffers']])performanceFolder.addBinding(stats,key,{label,readonly:true});
pane.addBinding(settings,'paused',{label:'Pause'});
pane.addButton({title:'Reset simulation'}).on('click',()=>{settings.seed++;scheduleReset();});
pane.addButton({title:'Reset camera'}).on('click',fitCamera);
if(innerWidth<600)pane.expanded=false;
function fail(error) {
  const message=error instanceof Error?error.message:String(error);errors.push(message);console.error(message);
  stats.state=message;stopped=true;refreshGui();
}
function fitCamera() {
  orbit.target.set(0,settings.height*.22,0);orbit.yaw=.42;orbit.pitch=.38;
  const aspect=Math.max(.4,innerWidth/innerHeight);
  orbit.distance=Math.max(settings.width/Math.min(aspect,1),settings.height,settings.depth)*2.0;
  cameraDirty=true;
}
function resize() {
  if(!world)return;
  const ratio=settings.pixelRatio;
  const max=world.device.limits.maxTextureDimension2D;
  world.resize(Math.min(max,Math.max(1,Math.round(innerWidth*ratio))),Math.min(max,Math.max(1,Math.round(innerHeight*ratio))));
  orbit.distance*=Math.min(camera.aspect,1)/Math.min(innerWidth/innerHeight,1);
  camera.aspect=innerWidth/innerHeight;camera.setViewOffset(innerWidth,innerHeight,innerWidth>700?70:0,0,innerWidth,innerHeight);camera.updateProjectionMatrix();cameraDirty=true;
}
function updateCamera() {
  camera.position.set(orbit.target.x+orbit.distance*Math.cos(orbit.pitch)*Math.sin(orbit.yaw),orbit.target.y+orbit.distance*Math.sin(orbit.pitch),orbit.target.z+orbit.distance*Math.cos(orbit.pitch)*Math.cos(orbit.yaw));
  camera.lookAt(orbit.target);
  // Keep reconstruction precise: a fixed 0.01 near plane loses millimeters of
  // world-space depth at the overview camera, causing false self-shadows.
  const p=camera.position;
  const distanceToBox=Math.hypot(Math.max(0,Math.abs(p.x)-settings.width/2),Math.max(0,-p.y,p.y-settings.height),Math.max(0,Math.abs(p.z)-settings.depth/2));
  camera.near=Math.max(.05,distanceToBox*.5);
  camera.far=p.distanceTo(new Vector3(0,settings.height/2,0))+Math.hypot(settings.width,settings.height,settings.depth);
  camera.updateProjectionMatrix();camera.updateMatrixWorld();cameraDirty=false;
}
function fillCamera() {
  if(cameraDirty)updateCamera();
  cameraData.set(camera.matrixWorldInverse.elements,0);cameraData.set(camera.projectionMatrix.elements,16);cameraData.set(camera.matrixWorld.elements,32);
  cameraData.set([...camera.position.toArray(),0],48);cameraData.set([settings.width/2,settings.height,settings.depth/2,0],52);
  cameraData.set([...cursor.position,settings.cursorRadius],56);
  // WGSL Camera contains 3 matrices + 4 vec4s (256 bytes).
  cameraData.set([Number(settings.color),0,0,0],60);
}
function restoreStructure(){if(world?.settings)for(const key of ['count','radius','variation','width','height','depth'])settings[key]=world.settings[key];}
function scheduleReset() {
  clearTimeout(rebuildTimer);busy=true;refreshGui();
  rebuildTimer=setTimeout(()=>reset(),100);
}
async function reset() {
  clearTimeout(rebuildTimer);
  const ticket=++generation;
  cancelSeed?.();cancelSeed=null;
  worker?.terminate();worker=null;
  if(!world)return;
  if(layout(settings).capacity<settings.count){restoreStructure();busy=false;stats.state='Too full — use Fit radius';refreshGui();return;}
  busy=true;stats.state='Seeding in WASM…';refreshGui();
  const seedWorker=new Worker(new URL('./seed-worker.js',import.meta.url),{type:'module'});
  worker=seedWorker;
  const snapshot={...settings};
  let cancelThisSeed;
  try {
    const buffer=await new Promise((resolve,reject)=>{
      cancelThisSeed=()=>reject(new Error('Initialization superseded'));
      cancelSeed=cancelThisSeed;
      seedWorker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.buffer);
      seedWorker.onerror=event=>reject(new Error(event.message));
      seedWorker.postMessage({settings:snapshot,url:new URL(`${import.meta.env.BASE_URL}seed.wasm`,location.href).href});
    });
    seedWorker.terminate();if(worker===seedWorker)worker=null;
    if(cancelSeed===cancelThisSeed)cancelSeed=null;
    if(ticket!==generation)return;
    stats.state='Uploading to GPU…';refreshGui();
    // Serialize GPU replacements; superseded seed jobs may finish in any order.
    const upload=uploadChain.then(async()=>{
      if(ticket!==generation)return false;
      await world.reset(snapshot,new Float32Array(buffer));
      return ticket===generation;
    });
    uploadChain=upload.then(()=>{},()=>{});
    if(!await upload)return;
    stats.actual=snapshot.count.toLocaleString();stats.memory=`${world.memoryMB.toFixed(1)} MB`;
    stats.state='Running';stopped=false;cursor.active=false;accumulator=0;last=performance.now();
    fitCamera();
  }catch(error){
    if(ticket===generation){restoreStructure();stats.state=error.message;errors.push(error.message);}
  }finally{
    seedWorker.terminate();if(worker===seedWorker)worker=null;
    if(cancelSeed===cancelThisSeed)cancelSeed=null;
    if(ticket===generation){busy=false;refreshGui();}
  }
}

function updateCursor(x,y) {
  if(cameraDirty)updateCamera();
  const rect=canvas.getBoundingClientRect();
  raycaster.setFromCamera({x:(x-rect.left)/rect.width*2-1,y:1-(y-rect.top)/rect.height*2},camera);
  const normal=camera.getWorldDirection(new Vector3());
  const depth=(settings.cursorDepth-.5)*settings.depth;
  const anchor=orbit.target.clone().addScaledVector(normal,depth);
  const point=raycaster.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal,anchor),new Vector3());
  if(!point)return;
  const r=settings.cursorRadius;
  point.x=Math.max(-settings.width/2+r,Math.min(settings.width/2-r,point.x));
  point.y=Math.max(r,Math.min(settings.height-r,point.y));
  point.z=Math.max(-settings.depth/2+r,Math.min(settings.depth/2-r,point.z));
  const now=performance.now();const dt=Math.max(1/120,(now-lastCursorTime)/1000);
  const velocity=lastCursor?point.clone().sub(lastCursor).divideScalar(dt):new Vector3();
  velocity.clampLength(0,18);cursor.position=point.toArray();cursor.velocity=velocity.toArray();cursor.active=true;
  lastCursor=point;lastCursorTime=now;
}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  canvas.setPointerCapture(e.pointerId);canvas.focus();
  pointer={button:e.altKey?2:e.button,x:e.clientX,y:e.clientY,id:e.pointerId};
  if(pointer.button===0){lastCursor=null;updateCursor(e.clientX,e.clientY);}
});
canvas.addEventListener('pointermove',e=>{
  if(!pointer)return;
  if(pointer.button===0)updateCursor(e.clientX,e.clientY);
  else {orbit.yaw-=(e.clientX-pointer.x)*.006;orbit.pitch=Math.max(.05,Math.min(1.48,orbit.pitch+(e.clientY-pointer.y)*.006));cameraDirty=true;}
  pointer.x=e.clientX;pointer.y=e.clientY;
});
function release(){pointer=null;cursor.active=false;cursor.velocity=[0,0,0];lastCursor=null;}
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,release);
window.addEventListener('blur',release);
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.shiftKey){settings.cursorDepth=Math.max(0,Math.min(1,settings.cursorDepth+e.deltaY*.001));if(pointer?.button===0)updateCursor(pointer.x,pointer.y);refreshGui();}
  else {orbit.distance=Math.max(Math.max(settings.width,settings.height,settings.depth)*.5,Math.min(200,orbit.distance*Math.exp(e.deltaY*.001)));cameraDirty=true;}
},{passive:false});
canvas.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();settings.paused=!settings.paused;refreshGui();}if(e.code==='Escape')release();});
window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{last=performance.now();accumulator=0;release();});
async function frame(now) {
  requestAnimationFrame(frame);
  if(!world||busy||stopped||document.hidden||framePending||stepping)return;
  const elapsed=Math.min((now-last)/1000,.1);last=now;
  framePending=true;
  try {
    accumulator=Math.min(accumulator+elapsed*settings.timeScale,2/60);
    const maxSteps=world.gpuMs>16.7?1:2;
    const steps=settings.paused?0:Math.min(maxSteps,Math.floor(accumulator*60));
    if(settings.paused)accumulator=0;else accumulator-=steps/60;
    if(performance.now()-lastCursorTime>70)cursor.velocity=[0,0,0];
    fillCamera();world.frame(settings,cameraData,cursor,steps);
    // Apply backpressure: never queue unbounded frames on a slow GPU.
    await world.device.queue.onSubmittedWorkDone();
    frameCount++;frameElapsed+=elapsed;
    if(now-(frame.statsAt??0)>750){
      stats.fps=(frameCount*1000/(now-(frame.statsAt??now-750))).toFixed(0);
      stats.visible=world.timestamp?world.visibleCount.toLocaleString():'Not sampled';
      stats.physics=world.timestamp?`${(world.physicsMs??0).toFixed(1)} ms`:'Not available';
      stats.render=world.timestamp?`${((world.renderMs??0)+(world.visibilityMs??0)).toFixed(1)} ms`:'Not available';
      stats.shadow=world.timestamp?`${(world.shadowMs??0).toFixed(1)} ms`:'Not available';
      stats.ao=world.timestamp?`${(world.aoMs??0).toFixed(1)} ms`:'Not available';
      stats.lighting=world.timestamp?`${(world.lightingMs??0).toFixed(1)} ms`:'Not available';
      stats.gpu=world.timestamp?`${world.gpuMs.toFixed(1)} ms`:'Not available';
      if(!busy&&['Running','Paused'].includes(stats.state))stats.state=settings.paused?'Paused':'Running';
      frameCount=0;frameElapsed=0;frame.statsAt=now;refreshGui();
    }
  }catch(error){fail(error);}
  finally{framePending=false;}
}
try {
  world=await GPUWorld.create(canvas,fail);resize();fitCamera();await reset();requestAnimationFrame(frame);
}catch(error){fail(error);}
// Deliberate development diagnostics: GPU readback occurs only when explicitly requested.
window.sphereLab={settings,stats,errors,get world(){return world;},get cursor(){return {...cursor};},reset,fitRadius:()=>{settings.radius=fitRadius(settings);return settings.radius;},
  snapshot:count=>world.snapshot(count),
  async step(frames=1,physicsSteps=1){settings.paused=true;stepping=true;try{while(framePending)await new Promise(r=>setTimeout(r,10));fillCamera();for(let i=0;i<frames;i++){world.frame(settings,cameraData,cursor,physicsSteps);await world.device.queue.onSubmittedWorkDone();}}finally{stepping=false;}},
  async capture(){
    stepping=true;
    try{
      while(framePending)await new Promise(r=>setTimeout(r,10));fillCamera();
      const {buffer,bytesPerRow,width,height}=world.frame(settings,cameraData,cursor,0,true);
      try{
        await buffer.mapAsync(GPUMapMode.READ);
        const source=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(width*height*4);
        for(let y=0;y<height;y++)pixels.set(source.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
        buffer.unmap();return pixels;
      }finally{buffer.destroy();}
    }finally{stepping=false;}
  },
  setCursor(position,active=true,velocity=[0,0,0]){Object.assign(cursor,{position,active,velocity});lastCursorTime=performance.now();},
};
