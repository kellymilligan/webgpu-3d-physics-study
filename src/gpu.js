import { Lighting } from './lighting.js';
import { Visibility } from './culling.js';
import renderCode from './shaders/render.wgsl?raw';
import materialCode from './shaders/materials.wgsl?raw';
import shapeCode from './shaders/shapes.wgsl?raw';

export class GPUWorld {
  static async create(canvas,onError,physics) {
    if(!navigator.gpu)throw new Error('WebGPU is unavailable. Open in a WebGPU-enabled browser on localhost or HTTPS.');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw new Error('No WebGPU adapter available. Enable hardware acceleration in your browser.');
    const timestamp=adapter.features.has('timestamp-query');
    const device=await adapter.requestDevice({requiredFeatures:timestamp?['timestamp-query']:[]});
    device.addEventListener('uncapturederror',e=>onError(e.error.message));
    device.lost.then(info=>onError(`GPU connection lost: ${info.message || info.reason}. Reload to restart.`));
    const world=new GPUWorld(canvas,device,adapter,timestamp,physics);
    await world.initialize();return world;
  }
  constructor(canvas,device,adapter,timestamp,physics) {
    Object.assign(this,{canvas,device,adapter,timestamp,physics,index:0,buffers:[],inFlight:false,gpuMs:0,physicsMs:0});
    this.context=canvas.getContext('webgpu');
    this.format=navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({device,format:this.format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  }
  buffer(size,usage,label) {return this.device.createBuffer({size:Math.ceil(size/4)*4,usage,label});}
  async module(code,label) {
    const module=this.device.createShaderModule({code,label});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length)throw new Error(errors.map(e=>`${label}:${e.lineNum} ${e.message}`).join('\n'));
    return module;
  }
  async initialize() {
    const d=this.device, S=GPUShaderStage;
    this.camera=this.buffer(256,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'camera');
    this.cursorCamera=this.buffer(256,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'cursor camera');
    this.renderLayout=d.createBindGroupLayout({entries:[
      {binding:0,visibility:S.VERTEX|S.FRAGMENT,buffer:{type:'uniform'}},
      {binding:1,visibility:S.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:2,visibility:S.VERTEX,buffer:{type:'read-only-storage'}},
    ]});
    const renderModule=await this.module(materialCode+shapeCode+renderCode,'render');
    const renderLayout=d.createPipelineLayout({bindGroupLayouts:[this.renderLayout]});
    const common={layout:renderLayout,primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}};
    this.spheres=await d.createRenderPipelineAsync({...common,vertex:{module:renderModule,entryPoint:'sphereVertex'},fragment:{module:renderModule,entryPoint:'sphereGeometry',targets:[{format:'rgba8unorm'},{format:'rgba16float'}]}});
    this.depthSpheres=await d.createRenderPipelineAsync({...common,vertex:{module:renderModule,entryPoint:'sphereVertex'},fragment:{module:renderModule,entryPoint:'sphereDepth',targets:[]}});
    this.visibility=new Visibility(this);await this.visibility.initialize();
    this.cursorPipeline=await d.createRenderPipelineAsync({...common,depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'},vertex:{module:renderModule,entryPoint:'sphereVertex'},fragment:{module:renderModule,entryPoint:'sphereFragment',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
    this.ground=await d.createRenderPipelineAsync({...common,vertex:{module:renderModule,entryPoint:'groundVertex'},fragment:{module:renderModule,entryPoint:'groundGeometry',targets:[{format:'rgba8unorm'},{format:'rgba16float'}]}});
    this.lighting=new Lighting(this);await this.lighting.initialize();
    if(this.timestamp){
      this.query=d.createQuerySet({type:'timestamp',count:11});
      this.queryResolve=this.buffer(88,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC,'timing resolve');
      this.queryRead=this.buffer(112,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'timing read');
    }
  }
  async reset(settings,seeds) {
    await this.device.queue.onSubmittedWorkDone();
    const s={...settings};const bytes=s.count*64;
    if(bytes>this.device.limits.maxStorageBufferBindingSize)throw new Error('This GPU cannot bind the selected body count. Choose fewer bodies.');
    const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
    // Build the replacement before releasing the previous live state.
    this.device.pushErrorScope('out-of-memory');
    const stateBuffer=this.buffer(bytes,usage,'Box3D body transforms');
    const buffers=[stateBuffer,stateBuffer];
    const error=await this.device.popErrorScope();
    if(error){stateBuffer.destroy();throw new Error('GPU memory allocation failed. Choose fewer bodies.');}
    this.stateBuffer?.destroy();this.stateBuffer=stateBuffer;this.buffers=buffers;
    Object.assign(this,{settings:s,count:s.count,index:0});
    this.device.queue.writeBuffer(stateBuffer,0,seeds);
    this.visibility.reset();
    this.lighting.reset();
    this.renderGroups=[0,1].map(i=>[0,1].map(list=>this.device.createBindGroup({layout:this.renderLayout,entries:[{binding:0,resource:{buffer:this.camera}},{binding:1,resource:{buffer:buffers[i]}},{binding:2,resource:{buffer:this.visibility.lists[list]}}]})));
    this.cursorGroups=[0,1].map(i=>this.device.createBindGroup({layout:this.renderLayout,entries:[{binding:0,resource:{buffer:this.cursorCamera}},{binding:1,resource:{buffer:buffers[i]}},{binding:2,resource:{buffer:this.visibility.lists[0]}}]}));
    this.memoryMB=(bytes+s.count*12+32)/1048576;
    this.visibleCount=s.count;

  }
  resize(width,height) {
    if(this.depth && width===this.canvas.width && height===this.canvas.height)return;
    this.canvas.width=width;this.canvas.height=height;
    this.depth?.destroy();this.depth=this.device.createTexture({size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    this.lighting.resize(width,height);
    this.visibility.resize(width,height);
  }
  frame(s,cameraData,cursor,steps=1,capture=false) {
    if(!this.count)return;
    const d=this.device,start=performance.now();
    if(steps>0){const state=this.physics.step(s,cursor,steps);d.queue.writeBuffer(this.stateBuffer,0,state);}
    this.physicsMs=performance.now()-start;
    this.lighting.prepare(s,cameraData);
    cameraData[62]=s.culling?1:0;
    d.queue.writeBuffer(this.camera,0,cameraData);
    const cursorData=cameraData.slice();cursorData[61]=1;d.queue.writeBuffer(this.cursorCamera,0,cursorData);
    const encoder=d.createCommandEncoder();
    const timed=this.timestamp && !this.queryPending;
    if(timed){const marker=encoder.beginComputePass({timestampWrites:{querySet:this.query,beginningOfPassWriteIndex:0}});marker.end();}
    if(s.culling)this.visibility.encode(encoder,timed);
    if(s.shadows)this.lighting.encodeShadow(encoder,timed);
    const outputTexture=this.context.getCurrentTexture();
    const pass=encoder.beginRenderPass({label:'body geometry buffers',colorAttachments:[
      {view:this.lighting.albedo.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}},
      {view:this.lighting.normal.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}},
    ],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1},timestampWrites:timed?{querySet:this.query,beginningOfPassWriteIndex:5,endOfPassWriteIndex:6}:undefined});
    pass.setPipeline(this.ground);pass.setBindGroup(0,this.renderGroups[this.index][this.visibility.index]);pass.draw(6);
    pass.setPipeline(this.spheres);
    if(s.culling)pass.drawIndirect(this.visibility.args[this.visibility.index],0);else pass.draw(6,this.count);
    pass.end();
    if(s.ao)this.lighting.encodeAO(encoder,timed);
    this.lighting.encodeLighting(encoder,outputTexture,cursor,timed);
    if(timed){
      encoder.resolveQuerySet(this.query,0,11,this.queryResolve,0);encoder.copyBufferToBuffer(this.queryResolve,0,this.queryRead,0,88);
      if(s.culling)encoder.copyBufferToBuffer(this.visibility.args[this.visibility.index],4,this.queryRead,96,4);
      this.queryPending=true;
    }
    let captured;
    if(capture){
      const bytesPerRow=Math.ceil(this.canvas.width*4/256)*256;
      const buffer=this.buffer(bytesPerRow*this.canvas.height,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'explicit frame capture');
      encoder.copyTextureToBuffer({texture:outputTexture},{buffer,bytesPerRow},[this.canvas.width,this.canvas.height]);
      captured={buffer,bytesPerRow,width:this.canvas.width,height:this.canvas.height};
    }
    d.queue.submit([encoder.finish()]);
    const culled=s.culling,shadows=s.shadows,ao=s.ao;
    if(timed)this.queryRead.mapAsync(GPUMapMode.READ).then(()=>{
      const range=this.queryRead.getMappedRange(),values=new BigUint64Array(range,0,11);
      const renderStart=culled?1:(shadows?3:5);
      this.gpuMs=Number(values[10]-values[steps>0?0:renderStart])/1e6;
      this.visibilityMs=culled?Number(values[2]-values[1])/1e6:0;
      this.shadowMs=shadows?Number(values[4]-values[3])/1e6:0;
      this.geometryMs=Number(values[6]-values[5])/1e6;
      this.aoMs=ao?Number(values[8]-values[7])/1e6:0;
      this.lightingMs=Number(values[10]-values[9])/1e6;
      // Render passes can overlap (vertex work may begin before an earlier
      // pass finishes). Their timestamp spans must not be added together.
      this.renderMs=Number(values[10]-values[renderStart])/1e6-this.visibilityMs;
      this.visibleCount=culled?new Uint32Array(range,96,1)[0]:this.count;
      this.queryRead.unmap();this.queryPending=false;
    }).catch(()=>{this.queryPending=false;});
    return captured;
  }
  async snapshot(count=this.count) {return this.physics.state(count);}
}
