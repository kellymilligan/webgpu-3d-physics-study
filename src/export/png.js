const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
export function pngChunk(type,data=new Uint8Array()){
  const result=new Uint8Array(data.length+12),view=new DataView(result.buffer);view.setUint32(0,data.length);
  for(let i=0;i<4;i++)result[4+i]=type.charCodeAt(i);result.set(data,8);
  let crc=0xffffffff;for(let i=4;i<result.length-4;i++)crc=table[(crc^result[i])&255]^(crc>>>8);
  view.setUint32(result.length-4,(crc^0xffffffff)>>>0);return result;
}
// Streaming 16-bit RGB PNG: only a strip and compressed chunks need to be resident.
export class PNGWriter {
  static async create(width,height,dpi,sink){const writer=new PNGWriter(width,height,sink);await writer.start(dpi);return writer;}
  constructor(width,height,sink){this.width=width;this.height=height;this.rows=0;this.sink=sink;}
  async start(dpi){
    await this.sink.write(new Uint8Array([137,80,78,71,13,10,26,10]));
    const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);v.setUint32(0,this.width);v.setUint32(4,this.height);ihdr[8]=16;ihdr[9]=2;
    await this.sink.write(pngChunk('IHDR',ihdr));await this.sink.write(pngChunk('sRGB',new Uint8Array([0])));
    const physical=new Uint8Array(9),p=new DataView(physical.buffer);p.setUint32(0,Math.round(dpi/.0254));p.setUint32(4,Math.round(dpi/.0254));physical[8]=1;
    await this.sink.write(pngChunk('pHYs',physical));
    const stream=new CompressionStream('deflate');this.input=stream.writable.getWriter();this.reader=stream.readable.getReader();
    this.pumping=(async()=>{for(;;){const {done,value}=await this.reader.read();if(done)break;await this.sink.write(pngChunk('IDAT',value));}})();
    // Observe sink failures immediately; close/addRows also propagate them to the caller.
    this.pumping.catch(error=>{this.error=error;this.input.abort(error).catch(()=>{});});
  }
  async addRows(rgb,rows){
    if(this.error)throw this.error;
    if(rgb.length!==this.width*rows*6||this.rows+rows>this.height)throw new Error('Invalid PNG strip');
    const stride=this.width*6,filtered=new Uint8Array((stride+1)*rows);
    // Sub filtering improves compression of smooth, high bit-depth gradients.
    for(let y=0;y<rows;y++){const out=y*(stride+1),input=y*stride;filtered[out]=1;for(let x=0;x<stride;x++)filtered[out+1+x]=(rgb[input+x]-(x>=6?rgb[input+x-6]:0))&255;}
    await this.input.write(filtered);this.rows+=rows;
  }
  async close(){if(this.rows!==this.height)throw new Error('Incomplete PNG');await this.input.close();await this.pumping;if(this.error)throw this.error;await this.sink.write(pngChunk('IEND'));await this.sink.close();}
  async abort(){await this.input?.abort().catch(()=>{});await this.reader?.cancel().catch(()=>{});await this.pumping?.catch(()=>{});await this.sink.abort?.();}
}
export function printDimensions(longInches,dpi,aspect){
  if(!Number.isFinite(aspect)||aspect<=0)throw new Error('Invalid image aspect');
  const long=Math.round(longInches*dpi);if(!Number.isInteger(long)||long<16||long>24000)throw new Error('Choose a long edge between 16 and 24,000 pixels');
  return {width:aspect>=1?long:Math.max(1,Math.round(long*aspect)),height:aspect>=1?Math.max(1,Math.round(long/aspect)):long};
}

export function renderDimensions(options,aspect){
  return options.preset==='studio5k'?{width:5120,height:2880}:printDimensions(options.longInches,options.dpi,aspect);
}
// Center crop in viewport pixels; preserves camera perspective for fixed-aspect output.
export function cropFrame(width,height,aspect){
  const w=Math.min(width,height*aspect),h=w/aspect;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
