// A compact Morton-ordered BVH. Leaves retain original sphere IDs/materials.
export function buildBVH(state) {
  const count=state.length/12;
  if(!Number.isInteger(count)||count<1)throw new Error('Empty or invalid sphere snapshot');
  const positions=new Float32Array(count*4),codes=new Uint32Array(count);
  let ids=new Uint32Array(count),scratch=new Uint32Array(count);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let k=0;k<4;k++){
    const v=state[i*12+k];if(!Number.isFinite(v)||(k===3&&v<=0))throw new Error('Invalid sphere in snapshot');
    positions[i*4+k]=v;if(k<3){lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);}
  }
  function spread(v){v&=1023;v=(v|(v<<16))&0x030000ff;v=(v|(v<<8))&0x0300f00f;v=(v|(v<<4))&0x030c30c3;return (v|(v<<2))&0x09249249;}
  const scale=hi.map((v,k)=>1023/Math.max(1e-9,v-lo[k]));
  for(let i=0;i<count;i++){
    const q=lo.map((v,k)=>Math.min(1023,Math.max(0,Math.floor((positions[i*4+k]-v)*scale[k]))));
    codes[i]=(spread(q[0])|(spread(q[1])<<1)|(spread(q[2])<<2))>>>0;ids[i]=i;
  }
  const bins=new Uint32Array(256);
  for(let shift=0;shift<32;shift+=8){
    bins.fill(0);for(let i=0;i<count;i++)bins[(codes[ids[i]]>>>shift)&255]++;
    let offset=0;for(let i=0;i<256;i++){const n=bins[i];bins[i]=offset;offset+=n;}
    for(let i=0;i<count;i++){const id=ids[i];scratch[bins[(codes[id]>>>shift)&255]++]=id;}
    [ids,scratch]=[scratch,ids];
  }
  // A balanced binary tree over Morton-sorted leaves gives a bounded traversal stack.
  const leaves=Math.ceil(count/8),buffer=new ArrayBuffer((2*leaves-1)*32);
  const f=new Float32Array(buffer),u=new Uint32Array(buffer);let next=0;
  function node(first,last){
    const index=next++,o=index*8;
    if(last-first===1){
      const start=first*8,end=Math.min(count,start+8);u[o+3]=start;u[o+7]=0x80000000|(end-start);
      f[o]=f[o+1]=f[o+2]=Infinity;f[o+4]=f[o+5]=f[o+6]=-Infinity;
      for(let j=start;j<end;j++){const p=ids[j]*4,r=positions[p+3];for(let k=0;k<3;k++){f[o+k]=Math.min(f[o+k],positions[p+k]-r-1e-5);f[o+4+k]=Math.max(f[o+4+k],positions[p+k]+r+1e-5);}}
    }else{
      const middle=(first+last)>>>1,a=node(first,middle),b=node(middle,last);u[o+3]=a;u[o+7]=b;
      for(let k=0;k<3;k++){f[o+k]=Math.min(f[a*8+k],f[b*8+k]);f[o+4+k]=Math.max(f[a*8+4+k],f[b*8+4+k]);}
    }
    return index;
  }
  node(0,leaves);return {positions,indices:ids,nodes:buffer,count,nodeCount:next};
}
