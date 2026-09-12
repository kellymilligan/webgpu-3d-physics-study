import {Matrix4,Vector3} from 'three';
import materialCode from '../shaders/materials.wgsl?raw';
import pathCode from '../shaders/path-trace.wgsl?raw';
import {PNGWriter} from './png.js';
export function packMaterials(s){return s.materialMix?1|(Math.round(s.glassShare*100)<<1)|(Math.round(s.chromeShare*100)<<8):0;}
function check(signal){if(signal?.aborted)throw new DOMException('Render cancelled','AbortError');}
function build(state,signal){return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./bvh-worker.js',import.meta.url),{type:'module'});
  const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',cancel);};
  const cancel=()=>{cleanup();reject(new DOMException('Render cancelled','AbortError'));};
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
  worker.onmessage=({data})=>{cleanup();data.error?reject(new Error(data.error)):resolve(data);};worker.onerror=e=>{cleanup();reject(new Error(e.message));};
  worker.postMessage(state.buffer,[state.buffer]);
});}
function display(value,exposure){const x=Math.max(0,value*exposure);const mapped=Math.max(0,Math.min(1,(x*(2.51*x+.03))/(x*(2.43*x+.59)+.14)));return mapped<=.0031308?mapped*12.92:1.055*Math.pow(mapped,1/2.4)-.055;}
export class PathTracer {
  constructor(world){this.world=world;this.device=world.device;}
  async initialize(){if(this.pipeline)return;const module=await this.world.module(materialCode+pathCode,'path tracer');this.pipeline=await this.device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'render'}});}
  async render({state,camera,settings:s,options,sink,onProgress=()=>{},onTile=()=>{},signal}){
    const {width,height,samples,bounces,dpi}=options,tileSize=options.tileSize??128;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>24000||!Number.isInteger(samples)||samples<1||samples>16384||!Number.isInteger(bounces)||bounces<2||bounces>64||!Number.isInteger(tileSize)||tileSize<8||tileSize>256)throw new Error('Invalid render dimensions or quality');
    let png;const resources=[];const start=performance.now();
    try{
      check(signal);onProgress({phase:'Building ray acceleration…',fraction:0});
      let scene=await build(state,signal);check(signal);await this.initialize();check(signal);
      const d=this.device;
      d.pushErrorScope('out-of-memory');
      const buffer=(size,usage,label)=>{if(size>d.limits.maxBufferSize)throw new Error(`${label} exceeds the GPU buffer limit`);const b=d.createBuffer({size,usage,label});resources.push(b);return b;};
      const upload=(array,label)=>{if(array.byteLength>d.limits.maxStorageBufferBindingSize)throw new Error(`${label} exceeds this GPU's storage binding limit`);const b=buffer(array.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label);d.queue.writeBuffer(b,0,array);return b;};
      let positions,indices,nodes,uniform,accumulation,read;
      try{
        positions=upload(scene.positions,'frozen spheres');indices=upload(scene.indices,'ray sphere IDs');nodes=upload(scene.nodes,'sphere BVH');
        uniform=buffer(272,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'path parameters');
        accumulation=buffer(tileSize*tileSize*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'HDR tile');
        read=buffer(tileSize*tileSize*16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST,'tile readback');
      }finally{const allocationError=await d.popErrorScope();if(allocationError)throw new Error('Not enough GPU memory for this still. Choose fewer spheres.');}
      this.lastScene={count:scene.count,nodes:scene.nodeCount,bytes:scene.positions.byteLength+scene.indices.byteLength+scene.nodes.byteLength};
      scene=null; // Uploads copy their source; release CPU geometry during long renders.
      const group=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[uniform,positions,indices,nodes,accumulation].map((b,binding)=>({binding,resource:{buffer:b}}))});
      const data=new ArrayBuffer(272),f=new Float32Array(data),u=new Uint32Array(data);
      f.set(new Matrix4().fromArray(camera,16).invert().elements,0);f.set(camera.subarray(32,48),16);u.set([width,height,0,0],32);
      f.set([s.width/2,s.height,s.depth/2,s.color],40);f.set([packMaterials(s),s.roughness,s.metallic,s.glassIOR],44);
      const az=s.lightAzimuth*Math.PI/180,el=s.lightElevation*Math.PI/180;
      const direction=new Vector3(Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az));
      const distance=Math.hypot(s.width,s.height,s.depth)*2;const center=new Vector3(0,s.height*.5,0).addScaledVector(direction,distance);
      const normal=direction.clone().negate(),right=new Vector3().crossVectors(normal,new Vector3(0,1,0)).normalize(),up=new Vector3().crossVectors(right,normal).normalize();
      const radius=s.softboxSize/2;
      f.set([...center.toArray(),radius],48);f.set([...normal.toArray(),s.lightIntensity*distance*distance/(Math.PI*radius*radius)],52);
      f.set([...right.toArray(),0],56);f.set([...up.toArray(),0],60);f.set([s.ambientStrength,s.exposure,s.glassTint,0],64);
      png=await PNGWriter.create(width,height,dpi,sink);
      let completed=0,lastProgress=0;const total=width*height*samples;
      for(let y=0;y<height;y+=tileSize){
        check(signal);const th=Math.min(tileSize,height-y);const strip=new Uint8Array(width*th*6);
        for(let x=0;x<width;x+=tileSize){
          check(signal);const tw=Math.min(tileSize,width-x);u.set([x,y],34);u.set([tw,th,0,bounces],36);
          for(let sample=0;sample<samples;sample++){
            check(signal);u[38]=sample;d.queue.writeBuffer(uniform,0,data);
            const encoder=d.createCommandEncoder();const pass=encoder.beginComputePass({label:'path trace one sample'});pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(tw/8),Math.ceil(th/8));pass.end();d.queue.submit([encoder.finish()]);
            await d.queue.onSubmittedWorkDone();completed+=tw*th;
            if(performance.now()-lastProgress>200){
              lastProgress=performance.now();onProgress({phase:'Path tracing',fraction:completed/total,sample:sample+1,samples,elapsed:(performance.now()-start)/1000});
              // Yield to cancel/input events even on very fast GPUs.
              await new Promise(r=>setTimeout(r,0));
            }
          }
          check(signal);const encoder=d.createCommandEncoder();encoder.copyBufferToBuffer(accumulation,0,read,0,tw*th*16);d.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
          const hdr=new Float32Array(read.getMappedRange(),0,tw*th*4),preview=new Uint8ClampedArray(tw*th*4);
          for(let row=0;row<th;row++)for(let col=0;col<tw;col++){
            const i=(row*tw+col)*4,out=(row*width+x+col)*6;
            for(let k=0;k<3;k++){
              if(!Number.isFinite(hdr[i+k])){read.unmap();throw new Error('Non-finite radiance in output');}
              const v=display(hdr[i+k]/samples,s.exposure),word=Math.round(v*65535);strip[out+k*2]=word>>>8;strip[out+k*2+1]=word&255;preview[i+k]=Math.round(v*255);
            }preview[i+3]=255;
          }
          read.unmap();await onTile({x,y,width:tw,height:th,pixels:preview,fullWidth:width,fullHeight:height});
        }
        check(signal);await png.addRows(strip,th);
      }
      check(signal);onProgress({phase:'Writing PNG…',fraction:1});await png.close();png=null;
      const result={width,height,samples,bounces,seconds:(performance.now()-start)/1000,...this.lastScene};onProgress({phase:'Complete',fraction:1});return result;
    }catch(error){if(png)await png.abort().catch(()=>{});else await sink.abort?.().catch(()=>{});throw error;}
    finally{await this.device.queue.onSubmittedWorkDone().catch(()=>{});resources.forEach(b=>b.destroy());}
  }
}
