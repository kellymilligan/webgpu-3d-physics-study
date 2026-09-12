import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaults,fitRadius,layout} from '../src/config.js';
const wasm=await readFile(new URL('../public/seed.wasm',import.meta.url));
async function seed(s) {
  const {instance}=await WebAssembly.instantiate(wasm);const {memory,seed}=instance.exports;
  memory.grow(Math.ceil(s.count*48/65536)-1);const l=layout(s);
  seed(s.count,l.nx,l.nz,s.width,s.height,s.depth,s.radius,s.variation,s.mass,l.spacing,s.seed);
  return new Float32Array(memory.buffer,0,s.count*12);
}
test('WASM initializes all presets inside the box, including two million spheres',async()=>{
  for(const count of [10000,100000,200000,500000,1000000,2000000])for(const variation of [0,1]){
    const s={...defaults,count,variation};s.radius=fitRadius(s);
    assert.ok(layout(s).capacity>=count);const data=await seed(s);let min=Infinity,max=0;
    for(let i=0;i<data.length;i+=12){
      const [x,y,z,r]=data.subarray(i,i+4);assert.ok(Number.isFinite(x+y+z+r));
      assert.ok(Math.abs(x)+r<=s.width/2+1e-5);assert.ok(Math.abs(z)+r<=s.depth/2+1e-5);
      assert.ok(y-r>=-1e-5&&y+r<=s.height+1e-5);
      min=Math.min(min,r);max=Math.max(max,r);
      assert.ok(Math.abs(data[i+7]*s.mass*(r/s.radius)**3-1)<1e-5);
    }
    if(variation===0)assert.ok(Math.abs(max-min)<1e-7);else assert.ok(max/min>4.98);
  }
});
test('WASM seeds are deterministic and change with the random seed',async()=>{
  const s={...defaults,count:10000,variation:1,radius:.025};
  const a=await seed(s),b=await seed(s),c=await seed({...s,seed:s.seed+2});assert.deepEqual(a,b);assert.notDeepEqual(a,c);
});
