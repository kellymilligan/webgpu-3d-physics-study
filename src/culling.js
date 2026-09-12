import cullCode from './shaders/cull.wgsl?raw';
import baseCode from './shaders/depth-base.wgsl?raw';
import reduceCode from './shaders/depth-pyramid.wgsl?raw';

// Occluders are last frame's visible IDs, rasterized again with CURRENT transforms.
// Missing occluders only reduce efficiency; they cannot hide a newly revealed sphere.
export class Visibility {
  constructor(world) { this.world=world;this.device=world.device;this.index=0;this.lists=[];this.args=[]; }
  async initialize() {
    const d=this.device,w=this.world;
    this.info=w.buffer(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'culling dimensions');
    this.cull=await d.createComputePipelineAsync({layout:'auto',compute:{module:await w.module(cullCode,'visibility'),entryPoint:'cull'}});
    this.base=await d.createComputePipelineAsync({layout:'auto',compute:{module:await w.module(baseCode,'depth base'),entryPoint:'reduce'}});
    // r32float is unfilterable on baseline WebGPU. Explicitly declare the layout.
    const reductionLayout=d.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},
      {binding:1,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'r32float'}},
    ]});
    this.reduce=await d.createComputePipelineAsync({layout:d.createPipelineLayout({bindGroupLayouts:[reductionLayout]}),compute:{module:await w.module(reduceCode,'depth reduction'),entryPoint:'reduce'}});
  }
  reset() {
    const w=this.world;
    this.lists.forEach(b=>b.destroy());this.args.forEach(b=>b.destroy());
    this.lists=[0,1].map(i=>w.buffer(w.count*4,GPUBufferUsage.STORAGE,`visible IDs ${i}`));
    this.args=[0,1].map(i=>w.buffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,`visible draw ${i}`));
    this.args.forEach(b=>this.device.queue.writeBuffer(b,0,new Uint32Array([6,0,0,0])));
    this.index=0;this.groups();
  }
  resize(width,height) {
    const d=this.device;
    this.depth?.destroy();this.pyramid?.destroy();
    this.depth=d.createTexture({label:'current occluder depth',size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const power=n=>2**Math.ceil(Math.log2(Math.max(1,n)));
    this.width=power(Math.ceil(width/2));this.height=power(Math.ceil(height/2));
    this.levels=1+Math.floor(Math.log2(Math.max(this.width,this.height)));
    this.pyramid=d.createTexture({label:'conservative max-depth pyramid',size:[this.width,this.height],mipLevelCount:this.levels,format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});
    this.reductions=Array.from({length:this.levels},(_,level)=>{
      const pipeline=level===0?this.base:this.reduce;
      const source=level===0?this.depth.createView():this.pyramid.createView({baseMipLevel:level-1,mipLevelCount:1});
      const target=this.pyramid.createView({baseMipLevel:level,mipLevelCount:1});
      return {pipeline,group:d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source},{binding:1,resource:target}]}),width:Math.max(1,this.width>>level),height:Math.max(1,this.height>>level)};
    });
    this.groups();
  }
  groups() {
    const w=this.world,d=this.device;
    if(!this.pyramid||!this.lists.length)return;
    d.queue.writeBuffer(this.info,0,new Uint32Array([w.canvas.width,w.canvas.height,w.count,this.levels]));
    this.bindings=[0,1].map(state=>[0,1].map(list=>d.createBindGroup({layout:this.cull.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:w.camera}}, {binding:1,resource:{buffer:w.buffers[state]}},
      {binding:2,resource:this.pyramid.createView()}, {binding:3,resource:{buffer:this.lists[list]}},
      {binding:4,resource:{buffer:this.args[list]}}, {binding:5,resource:{buffer:this.info}},
    ]})));
  }
  encode(encoder,timed) {
    const w=this.world;
    const pass=encoder.beginRenderPass({label:'current-frame occluders',colorAttachments:[],depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1},timestampWrites:timed?{querySet:w.query,beginningOfPassWriteIndex:1}:undefined});
    pass.setPipeline(w.depthSpheres);pass.setBindGroup(0,w.renderGroups[w.index][this.index]);pass.drawIndirect(this.args[this.index],0);pass.end();
    for(const {pipeline,group,width,height} of this.reductions){
      const reduce=encoder.beginComputePass();reduce.setPipeline(pipeline);reduce.setBindGroup(0,group);reduce.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));reduce.end();
    }
    const output=1-this.index;
    encoder.clearBuffer(this.args[output],4,4);
    const cull=encoder.beginComputePass({label:'visibility compaction',timestampWrites:timed?{querySet:w.query,endOfPassWriteIndex:2}:undefined});
    cull.setPipeline(this.cull);cull.setBindGroup(0,this.bindings[w.index][output]);cull.dispatchWorkgroups(Math.ceil(w.count/128));cull.end();
    this.index=output;
  }
}
