import {defaults,counts,fitRadius} from './config.js';

export const storageKey='box3d-body-lab.preferences.v1';
export const exportDefaults={preset:'studio5k',longInches:40,dpi:300,samples:1024,bounces:16};
export function defaultSettings(){return {...defaults,radius:fitRadius(defaults)};}
const ranges={radius:[.01,1],variation:[1,100],variationBias:[.25,8],width:[4,60],height:[4,60],depth:[4,60],gravity:[0,30],restitution:[0,1],friction:[0,1.5],mass:[.05,10],damping:[0,3],substeps:[1,8],timeScale:[.1,2],cursorRadius:[.2,5],cursorStrength:[.1,2],cursorDepth:[0,1],shadowSoftness:[0,8],shadowBias:[0,.1],stripLength:[4,50],stripWidth:[.5,12],lightAzimuth:[-180,180],lightElevation:[10,85],lightIntensity:[0,8],ambientStrength:[0,2],roughness:[.06,1],metallic:[0,1],exposure:[.2,2.5],glassShare:[0,1],chromeShare:[0,1],glassIOR:[1.05,2.4],glassTint:[0,.8],softboxSize:[1,40],glowStrength:[0,12],frosting:[0,.85],aoRadius:[.05,3],aoStrength:[0,3],pixelRatio:[.5,2],seed:[1,4294967295],longInches:[4,60],dpi:[72,600],bounces:[4,64]};
const choices={count:Object.values(counts),color:[0,1,2,3,4,5],lightRig:['studio','single'],shadowResolution:[1024,2048,4096],aoQuality:[0,1,2],debugLighting:[0,1,2,3],preset:['studio5k','print'],samples:[64,256,1024,4096,16384]};
function validated(template,source){
  const result={...template};
  for(const [key,fallback] of Object.entries(template)){
    const value=source?.[key];
    if(typeof value!==typeof fallback)continue;
    if(choices[key]){if(choices[key].includes(value))result[key]=value;}
    else if(typeof value==='number'){
      if(!Number.isFinite(value))continue;
      const range=ranges[key];result[key]=range?Math.max(range[0],Math.min(range[1],value)):value;
      if(['substeps','seed','dpi','bounces'].includes(key))result[key]=Math.round(result[key]);
    }else result[key]=value;
  }
  return result;
}
export function readPreferences(storage){
  let saved;try{saved=JSON.parse(storage.getItem(storageKey));}catch{}
  const settings=validated(defaultSettings(),saved?.settings);
  if(!Object.keys(settings).some(key=>key.startsWith('shape_')&&settings[key]))settings.shape_sphere=true;
  const c=saved?.camera;
  const camera=c&&[c.yaw,c.pitch,c.distance,...(Array.isArray(c.target)?c.target:[])].length===6
    &&[c.yaw,c.pitch,c.distance,...c.target].every(Number.isFinite)&&c.distance>=1&&c.distance<=500
    &&c.pitch>=.05&&c.pitch<=1.48&&c.target.every(v=>Math.abs(v)<=1000)?c:null;
  return {settings,exportOptions:validated(exportDefaults,saved?.exportOptions),camera};
}
export function writePreferences(storage,settings,exportOptions,orbit){
  try{storage.setItem(storageKey,JSON.stringify({settings,exportOptions,camera:{yaw:orbit.yaw,pitch:orbit.pitch,distance:orbit.distance,target:orbit.target.toArray()}}));}catch{}
}
