import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const ready=()=>page.waitForFunction(()=>window.sphereLab?.world?.count>0,{timeout:60000});
try{
  await page.goto(process.env.TEST_URL??'http://127.0.0.1:5180');await ready();
  assert.equal(await page.evaluate(()=>sphereLab.settings.color),3);
  await page.getByRole('button',{name:'Material',exact:true}).click();
  await page.locator('.tp-lblv').filter({hasText:/^Theme/}).locator('select').selectOption({label:'Forest Glow'});
  await page.locator('.tp-lblv').filter({hasText:/^Samples \/ pixel/}).locator('select').selectOption({label:'4096'});
  await page.mouse.move(500,400);await page.mouse.down({button:'right'});await page.mouse.move(600,460);await page.mouse.up({button:'right'});await page.mouse.wheel(0,-160);
  await page.waitForTimeout(300);
  const before=await page.evaluate(()=>({settings:{...sphereLab.settings},options:{...sphereLab.exportOptions},camera:Array.from(sphereLab.cameraData)}));
  await page.reload();await ready();
  const after=await page.evaluate(()=>({settings:{...sphereLab.settings},options:{...sphereLab.exportOptions},camera:Array.from(sphereLab.cameraData)}));
  assert.deepEqual(after,before);console.log('GUI, export settings and camera restored after reload.');
  await page.getByRole('button',{name:'Reset settings',exact:true}).click();
  await page.waitForFunction(()=>sphereLab.settings.color===3&&sphereLab.stats.state==='Running');
  const reset=await page.evaluate(async()=>{
    const {defaultSettings,exportDefaults}=await import('/src/preferences.js');
    return {settings:{...sphereLab.settings},defaults:defaultSettings(),options:{...sphereLab.exportOptions},exportDefaults,yaw:sphereLab.orbit.yaw,pitch:sphereLab.orbit.pitch};
  });
  assert.deepEqual(reset.settings,reset.defaults);assert.deepEqual(reset.options,reset.exportDefaults);assert.equal(reset.yaw,.42);assert.equal(reset.pitch,.38);
  await page.reload();await ready();assert.equal(await page.evaluate(()=>sphereLab.settings.color),3);
  console.log('Reset settings restores and persists all defaults.');
  await page.evaluate(()=>{sphereLab.settings.paused=true;});

  const code=await readFile('src/shaders/shapes.wgsl','utf8');
  const cases=[],expected=[];
  for(let kind=0;kind<8;kind++)for(const scale of [.01,1,4])for(const axis of [0,1,2])for(const rotated of [false,true]){
    const shape=[kind,scale,scale,scale];let extent=scale,bound=Math.sqrt(3)*scale;
    if(kind===0)bound=scale;
    if(kind===2){shape[2]=3.43184;shape[3]=0;bound=3**(.5-1/shape[2])*scale;}
    if(kind===3){shape[1]=.55*scale;shape[2]=1.15*scale;shape[3]=0;extent=(axis===1?1.7:.55)*scale;bound=1.7*scale;}
    if(kind===4){shape[2]=1.2*scale;shape[3]=0;extent=(axis===1?1.2:1)*scale;bound=Math.hypot(1,1.2)*scale;}
    if(kind===5){extent=scale/Math.sqrt(3);bound=scale;}
    if(kind===6)bound=scale;
    if(kind===7){shape[3]=6*scale;extent=(axis===2?6:1)*scale;bound=Math.sqrt(38)*scale;}
    const q=rotated?new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.87):new Quaternion();
    const direction=new Vector3().setComponent(axis,1).applyQuaternion(q),center=new Vector3(8,7,-5);
    for(const scenario of ['primary','inside','reflection','transmission']){
      const epsilon=.00004;let distance=0,sign=1,target=extent;
      if(scenario==='primary'){distance=extent+10;sign=-1;target=10;}
      if(scenario==='reflection'){distance=extent+epsilon;target=-1;}
      if(scenario==='transmission'){distance=extent-epsilon;sign=-1;target=2*extent-epsilon;}
      cases.push(...center.clone().addScaledVector(direction,distance).toArray(),0,...direction.clone().multiplyScalar(sign).toArray(),0,...center.toArray(),bound,...q.toArray(),...shape);
      expected.push({kind,scale,axis,rotated,scenario,t:target});
    }
  }
  // Cylinder normals must vary continuously between the old polygon faces.
  // Include flat caps, near-tangent chords, misses and glass secondary rays.
  for(const scale of [.01,1,4])for(const rotated of [false,true]){
    const q=rotated?new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.87):new Quaternion();
    const center=new Vector3(8,7,-5),shape=[4,scale,1.2*scale,0],bound=Math.hypot(1,1.2)*scale;
    const add=(origin,direction,t,normal,scenario)=>{
      cases.push(...origin.clone().applyQuaternion(q).add(center).toArray(),0,...direction.clone().applyQuaternion(q).toArray(),0,...center.toArray(),bound,...q.toArray(),...shape);
      expected.push({kind:4,scale,rotated,scenario,t,normal:normal?.toArray()});
    };
    for(let i=0;i<32;i++){
      const angle=(i+.37)*Math.PI*2/32,n=new Vector3(Math.cos(angle),0,Math.sin(angle));
      const surface=n.clone().multiplyScalar(scale);surface.y=.4*scale;
      add(surface.clone().addScaledVector(n,2*scale),n.clone().negate(),2*scale,n,'smooth side');
      add(surface.clone().addScaledVector(n,.00004),n,-1,null,'smooth reflection');
      add(surface.clone().addScaledVector(n,-.00004),n.clone().negate(),2*scale-.00004,n.clone().negate(),'smooth transmission');
    }
    for(const sign of [-1,1]){
      const n=new Vector3(0,sign,0),surface=new Vector3(.23*scale,sign*1.2*scale,.37*scale);
      add(surface.clone().addScaledVector(n,2*scale),n.clone().negate(),2*scale,n,'off-axis cap');
      add(surface.clone().addScaledVector(n,-.00004),n.clone().negate(),2.4*scale-.00004,n.clone().negate(),'cap transmission');
      add(surface.clone().addScaledVector(n,.00004),n,-1,null,'cap reflection');
    }
    const x=.997*scale,z=Math.sqrt(scale*scale-x*x);
    add(new Vector3(x,.2*scale,3*scale),new Vector3(0,0,-1),3*scale-z,new Vector3(x,0,z).normalize(),'grazing side');
    add(new Vector3(1.002*scale,0,3*scale),new Vector3(0,0,-1),-1,null,'near-tangent miss');
    add(new Vector3(1.1*scale,3*scale,0),new Vector3(0,-1,0),-1,null,'axial miss');
  }
  const hits=await page.evaluate(async({code,cases})=>{
    const d=sphereLab.world.device;
    const shader=code+`\nstruct Case {origin:vec4f,direction:vec4f,center:vec4f,q:vec4f,shape:vec4f}
@group(0) @binding(0) var<storage,read> cases:array<Case>;
@group(0) @binding(1) var<storage,read_write> hits:array<vec4f>;
@compute @workgroup_size(64) fn check(@builtin(global_invocation_id) id:vec3u){if(id.x>=arrayLength(&cases)){return;}let c=cases[id.x];let h=intersectShape(c.origin.xyz,c.direction.xyz,c.center.xyz,c.q,c.shape,c.center.w);hits[id.x]=vec4f(h.t,h.normal);}`;
    const module=await sphereLab.world.module(shader,'ray regressions');const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'check'}});
    const input=d.createBuffer({size:cases.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(input,0,new Float32Array(cases));
    const size=cases.length/20*16,output=d.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    const group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[input,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(cases.length/20/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,size);d.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange()));read.unmap();input.destroy();output.destroy();read.destroy();return values;
  },{code,cases});
  for(let i=0;i<expected.length;i++){
    const e=expected[i],t=hits[i*4];assert.ok(Number.isFinite(t),JSON.stringify(e));
    if(e.t<0)assert.ok(t<0,`Self-hit ${JSON.stringify(e)}: ${t}`);
    else assert.ok(Math.abs(t-e.t)<Math.max(.000012,e.scale*.000015),`Bad root ${JSON.stringify(e)}: ${t}`);
    if(e.normal){const n=hits.slice(i*4+1,i*4+4);assert.ok(Math.hypot(...n.map((v,k)=>v-e.normal[k]))<.004,`Bad normal ${JSON.stringify(e)}: ${n}`);}
  }
  console.log(`${expected.length} GPU ray cases passed: all shapes, inside/outside, reflection/transmission, 400x scale range and rotated bodies.`);
  await mkdir('test-results',{recursive:true});
  // Smooth sphube still for visual inspection, using the actual exported tracer.
  await page.evaluate(async()=>{
    const l=sphereLab;for(const key of Object.keys(l.settings))if(key.startsWith('shape_'))l.settings[key]=key==='shape_sphube';
    Object.assign(l.settings,{count:100,radius:.42,variation:2,variationBias:2,paused:true,color:3});await l.reset();await l.step(240);
    await l.renderStill({options:{width:800,height:450,samples:256,bounces:20}});
  });
  await page.locator('#still-preview').screenshot({path:'test-results/sphube-review.png'});
  assert.deepEqual(errors,[]);console.log('Sphube path-traced review saved.');
  const cylinderImage=await page.evaluate(async()=>{
    const l=sphereLab;for(const key of Object.keys(l.settings))if(key.startsWith('shape_'))l.settings[key]=key==='shape_cylinder';
    Object.assign(l.settings,{count:100,width:8,height:6,depth:8,radius:.18,variation:2,variationBias:2,paused:true,color:2,materialMix:false,metallic:.8,roughness:.16});
    await l.reset();l.orbit.target.set(0,.6,0);l.orbit.distance=14;await l.step(240);
    await l.renderStill({options:{width:800,height:450,samples:256,bounces:20}});
    return document.querySelector('#still-preview').toDataURL('image/png').split(',')[1];
  });
  await writeFile('test-results/cylinder-review.png',Buffer.from(cylinderImage,'base64'));
  assert.deepEqual(errors,[]);console.log('Smooth cylinder path-traced review saved.');
}finally{await browser.close();}
