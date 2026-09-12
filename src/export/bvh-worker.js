import {buildBVH} from './bvh.js';
self.onmessage=({data})=>{try{const result=buildBVH(new Float32Array(data));self.postMessage(result,[result.positions.buffer,result.indices.buffer,result.nodes]);}catch(error){self.postMessage({error:error.message});}};
