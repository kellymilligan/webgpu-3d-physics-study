import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {buildBVH} from '../src/export/bvh.js';
import {PNGWriter,printDimensions} from '../src/export/png.js';

test('40-inch print dimensions and 16-bit PNG round-trip across strips',async()=>{
 assert.deepEqual(printDimensions(40,300,1.5),{width:12000,height:8000});assert.deepEqual(printDimensions(40,300,2/3),{width:8000,height:12000});
 const width=12000,height=17,chunks=[];let closed=false;
 const png=await PNGWriter.create(width,height,300,{write:async b=>chunks.push(b),close:async()=>{closed=true;}});
 const expected=new Uint8Array(width*height*6);for(let i=0;i<expected.length;i++)expected[i]=(i*53+(i>>8))&255;
 await png.addRows(expected.subarray(0,width*8*6),8);await png.addRows(expected.subarray(width*8*6),9);await png.close();assert.ok(closed);
 const file=Buffer.concat(chunks),idat=[];let depth,dimensions,dpi;
 for(let offset=8;offset<file.length;){const length=file.readUInt32BE(offset),type=file.toString('ascii',offset+4,offset+8),data=file.subarray(offset+8,offset+8+length);
  if(type==='IHDR'){dimensions=[data.readUInt32BE(0),data.readUInt32BE(4)];depth=data[8];}
  if(type==='pHYs')dpi=data.readUInt32BE(0)*.0254;
  if(type==='IDAT')idat.push(data);offset+=12+length;
 }
 assert.deepEqual(dimensions,[width,height]);assert.equal(depth,16);assert.ok(Math.abs(dpi-300)<.01);
 const raw=inflateSync(Buffer.concat(idat)),stride=width*6,reconstructed=new Uint8Array(expected.length);
 for(let y=0;y<height;y++){assert.equal(raw[y*(stride+1)],1);for(let x=0;x<stride;x++)reconstructed[y*stride+x]=(raw[y*(stride+1)+1+x]+(x>=6?reconstructed[y*stride+x-6]:0))&255;}
 assert.deepEqual(reconstructed,expected);
});

test('BVH includes all IDs and conservatively bounds every body',()=>{
 const state=new Float32Array(10003*16);for(let i=0;i<state.length/16;i++)state.set([Math.sin(i)*10,(i%37)*.2,Math.cos(i*1.7)*5,.02+(i%19)*.01,0,0,0,1,0,.1,.1,.1],i*16);
 const result=buildBVH(state),f=new Float32Array(result.nodes),u=new Uint32Array(result.nodes),found=[];
 function check(index,depth=0){assert.ok(depth<48);const o=index*8;
  if(u[o+7]&0x80000000){for(let j=0;j<(u[o+7]&0x7fffffff);j++){const id=result.indices[u[o+3]+j];found.push(id);for(let k=0;k<3;k++){assert.ok(f[o+k]<=state[id*16+k]-state[id*16+3]+2e-6);assert.ok(f[o+4+k]>=state[id*16+k]+state[id*16+3]-2e-6);}}}
  else{for(const child of [u[o+3],u[o+7]]){for(let k=0;k<3;k++){assert.ok(f[o+k]<=f[child*8+k]);assert.ok(f[o+4+k]>=f[child*8+4+k]);}check(child,depth+1);}}
 }
 check(0);assert.equal(new Set(found).size,10003);assert.equal(found.length,10003);
});

test('BVH ray traversal agrees with a brute-force bounding-sphere reference',()=>{
 const n=513,state=new Float32Array(n*16);for(let i=0;i<n;i++)state.set([Math.sin(i*.7)*8,Math.cos(i)*5,Math.sin(i*1.31)*7,.1+(i%11)*.03,0,0,0,1,0,.1,.1,.1],i*16);
 const bvh=buildBVH(state),f=new Float32Array(bvh.nodes),u=new Uint32Array(bvh.nodes);
 function sphere(id,o,d){const p=id*16,oc=o.map((v,k)=>v-state[p+k]),b=oc.reduce((sum,v,k)=>sum+v*d[k],0),h=state[p+3]**2-oc.reduce((sum,v,k)=>sum+(v-b*d[k])**2,0);if(h<0)return Infinity;const a=-b-Math.sqrt(h),c=-b+Math.sqrt(h);return a>0?a:c>0?c:Infinity;}
 function box(index,o,d,limit){let near=0,far=limit;for(let k=0;k<3;k++){let a=(f[index*8+k]-o[k])/d[k],b=(f[index*8+4+k]-o[k])/d[k];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}return near<=far;}
 for(let ray=0;ray<400;ray++){
  const o=[Math.sin(ray)*20,Math.cos(ray*.17)*15,Math.cos(ray)*20],aim=[Math.sin(ray*2)*8,Math.cos(ray*3)*5,Math.cos(ray*1.1)*7],raw=aim.map((v,k)=>v-o[k]),length=Math.hypot(...raw),d=raw.map(v=>v/length);
  let brute=Infinity,bounded=Infinity;for(let i=0;i<n;i++)brute=Math.min(brute,sphere(i,o,d));
  const stack=[0];while(stack.length){const node=stack.pop();if(!box(node,o,d,bounded))continue;const a=u[node*8+3],b=u[node*8+7];if(b&0x80000000){for(let j=0;j<(b&0x7fffffff);j++)bounded=Math.min(bounded,sphere(bvh.indices[a+j],o,d));}else stack.push(a,b);}
  assert.equal(bounded,brute);
 }
});

test('5K wallpaper stays 5120 × 2880 and crops portrait/wide viewports without stretching',async()=>{
 const {renderDimensions,cropFrame}=await import('../src/export/png.js');
 for(const aspect of [16/9,4/3,9/16,3])assert.deepEqual(renderDimensions({preset:'studio5k',longInches:40,dpi:300},aspect),{width:5120,height:2880});
 const portrait=cropFrame(900,1200,16/9);assert.equal(portrait.width,900);assert.equal(portrait.height,506.25);assert.equal(portrait.y,346.875);
 const wide=cropFrame(2400,1000,16/9);assert.equal(wide.height,1000);assert.ok(Math.abs(wide.width/wide.height-16/9)<1e-12);
 assert.deepEqual(renderDimensions({preset:'print',longInches:40,dpi:300},1.5),{width:12000,height:8000});
});
