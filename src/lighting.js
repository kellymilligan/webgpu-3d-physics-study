import { Matrix4, OrthographicCamera, Vector3, WebGPUCoordinateSystem } from 'three';
import commonCode from './shaders/lighting-common.wgsl?raw';
import shadowCode from './shaders/shadow.wgsl?raw';
import gtaoCode from './shaders/gtao.wgsl?raw';
import filterCode from './shaders/ao-filter.wgsl?raw';
import lightingCode from './shaders/lighting.wgsl?raw';

export class Lighting {
  constructor(world) {
    this.world=world;this.device=world.device;this.data=new Float32Array(72);
    this.inverseProjection=new Matrix4();this.lightCamera=new OrthographicCamera();
    this.lightCamera.coordinateSystem=WebGPUCoordinateSystem;
  }
  async initialize() {
    const d=this.device,w=this.world;
    this.uniform=w.buffer(288,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'lighting parameters');
    const shadowModule=await w.module(shadowCode,'sphere shadow map');
    this.shadowPipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:shadowModule,entryPoint:'vertex'},fragment:{module:shadowModule,entryPoint:'fragment',targets:[]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    this.aoPipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module:await w.module(commonCode+gtaoCode,'GTAO'),entryPoint:'gtao'}});
    this.filterPipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module:await w.module(commonCode+filterCode,'AO bilateral filter'),entryPoint:'filterAO'}});
    const lightingModule=await w.module(commonCode+lightingCode,'PBR lighting');
    this.pipeline=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:lightingModule,entryPoint:'vertex'},fragment:{module:lightingModule,entryPoint:'fragment',targets:[{format:w.format}]},primitive:{topology:'triangle-list'}});
    this.sampler=d.createSampler({compare:'less-equal',minFilter:'linear',magFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.resizeShadow(2048);
  }
  resizeShadow(resolution) {
    if(this.shadowResolution===resolution)return;
    this.shadowResolution=resolution;this.shadowTexture?.destroy();
    this.shadowTexture=this.device.createTexture({label:'directional light depth',size:[resolution,resolution],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.bindings();
  }
  resize(width,height) {
    for(const texture of [this.albedo,this.normal,this.rawAO,this.ao])texture?.destroy();
    const texture=(label,format,w,h,storage=false)=>this.device.createTexture({label,size:[w,h],format,usage:GPUTextureUsage.TEXTURE_BINDING|(storage?GPUTextureUsage.STORAGE_BINDING:GPUTextureUsage.RENDER_ATTACHMENT)});
    this.albedo=texture('linear albedo and material mask','rgba8unorm',width,height);
    this.normal=texture('analytic view normals','rgba16float',width,height);
    this.aoWidth=Math.ceil(width/2);this.aoHeight=Math.ceil(height/2);
    this.rawAO=texture('raw half-resolution GTAO','r32float',this.aoWidth,this.aoHeight,true);
    this.ao=texture('filtered half-resolution GTAO','r32float',this.aoWidth,this.aoHeight,true);
    this.bindings();
  }
  reset() {
    const w=this.world;
    this.shadowGroups=[0,1].map(i=>this.device.createBindGroup({layout:this.shadowPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:w.buffers[i]}}]}));
  }
  bindings() {
    const w=this.world,d=this.device;if(!this.albedo||!this.shadowTexture)return;
    const base=[{binding:0,resource:{buffer:w.camera}},{binding:1,resource:{buffer:this.uniform}},{binding:2,resource:w.depth.createView()},{binding:3,resource:this.normal.createView()}];
    this.aoGroup=d.createBindGroup({layout:this.aoPipeline.getBindGroupLayout(0),entries:[...base,{binding:4,resource:this.rawAO.createView()}]});
    // The filter does not use the camera directly; its auto-layout omits binding 0.
    this.filterGroup=d.createBindGroup({layout:this.filterPipeline.getBindGroupLayout(0),entries:[...base.slice(1),{binding:4,resource:this.rawAO.createView()},{binding:5,resource:this.ao.createView()}]});
    this.group=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[...base,{binding:4,resource:this.albedo.createView()},{binding:5,resource:this.ao.createView()},{binding:6,resource:this.shadowTexture.createView()},{binding:7,resource:this.sampler}]});
  }
  prepare(s,cameraData) {
    this.resizeShadow(s.shadowResolution);
    this.inverseProjection.fromArray(cameraData,16).invert();this.data.set(this.inverseProjection.elements,0);
    const azimuth=s.lightAzimuth*Math.PI/180,elevation=s.lightElevation*Math.PI/180;
    const direction=new Vector3(Math.cos(elevation)*Math.sin(azimuth),Math.sin(elevation),Math.cos(elevation)*Math.cos(azimuth));
    const center=new Vector3(0,s.height*.5,0),distance=Math.hypot(s.width,s.height,s.depth)*2;
    const camera=this.lightCamera;camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center);camera.updateMatrixWorld();
    const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
    for(const x of [-s.width/2,s.width/2])for(const y of [0,s.height])for(const z of [-s.depth/2,s.depth/2]){
      const p=new Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);min.min(p);max.max(p);
    }
    const pad=.2;camera.left=min.x-pad;camera.right=max.x+pad;camera.bottom=min.y-pad;camera.top=max.y+pad;
    camera.near=Math.max(.01,-max.z-pad);camera.far=-min.z+pad;camera.updateProjectionMatrix();
    this.data.set(camera.matrixWorldInverse.elements,16);this.data.set(camera.projectionMatrix.elements,32);
    this.data.set([...direction.toArray(),s.lightIntensity],48);
    this.data.set([s.ambientStrength,s.roughness,s.metallic,s.exposure],52);
    this.data.set([s.shadows?1:0,s.shadowSoftness,s.shadowBias,s.shadowResolution],56);
    this.data.set([s.ao?1:0,s.aoRadius,s.aoStrength,s.glassTint],60);
    this.data.set([this.world.canvas.width,this.world.canvas.height,this.aoWidth,this.aoHeight],64);
    const quality=[[2,4],[4,4],[6,6]][s.aoQuality];this.data.set([...quality,s.debugLighting,s.glassIOR],68);
    this.device.queue.writeBuffer(this.uniform,0,this.data);
  }
  encodeShadow(encoder,timed) {
    const w=this.world;
    const pass=encoder.beginRenderPass({label:'directional sphere shadows',colorAttachments:[],depthStencilAttachment:{view:this.shadowTexture.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1},timestampWrites:timed?{querySet:w.query,beginningOfPassWriteIndex:3,endOfPassWriteIndex:4}:undefined});
    // Camera-hidden spheres can still be light-visible shadow casters.
    pass.setPipeline(this.shadowPipeline);pass.setBindGroup(0,this.shadowGroups[w.index]);pass.draw(6,w.count);pass.end();
  }
  encodeAO(encoder,timed) {
    const w=this.world;
    let pass=encoder.beginComputePass({label:'GTAO horizon integration',timestampWrites:timed?{querySet:w.query,beginningOfPassWriteIndex:7}:undefined});
    pass.setPipeline(this.aoPipeline);pass.setBindGroup(0,this.aoGroup);pass.dispatchWorkgroups(Math.ceil(this.aoWidth/8),Math.ceil(this.aoHeight/8));pass.end();
    pass=encoder.beginComputePass({label:'AO bilateral filtering',timestampWrites:timed?{querySet:w.query,endOfPassWriteIndex:8}:undefined});
    pass.setPipeline(this.filterPipeline);pass.setBindGroup(0,this.filterGroup);pass.dispatchWorkgroups(Math.ceil(this.aoWidth/8),Math.ceil(this.aoHeight/8));pass.end();
  }
  encodeLighting(encoder,outputTexture,cursor,timed) {
    const w=this.world;
    const pass=encoder.beginRenderPass({label:'PBR lighting resolve',colorAttachments:[{view:outputTexture.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.073,g:.082,b:.095,a:1}}],timestampWrites:timed?{querySet:w.query,beginningOfPassWriteIndex:9,...(!cursor.active?{endOfPassWriteIndex:10}:{})}:undefined});
    pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(3);pass.end();
    if(cursor.active){
      const overlay=encoder.beginRenderPass({label:'cursor overlay',colorAttachments:[{view:outputTexture.createView(),loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:w.depth.createView(),depthReadOnly:true},timestampWrites:timed?{querySet:w.query,endOfPassWriteIndex:10}:undefined});
      overlay.setPipeline(w.cursorPipeline);overlay.setBindGroup(0,w.cursorGroups[w.index]);overlay.draw(6);overlay.end();
    }
  }
}
