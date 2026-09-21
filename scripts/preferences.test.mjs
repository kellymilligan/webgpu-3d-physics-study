import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences,writePreferences,defaultSettings,exportDefaults} from '../src/preferences.js';
test('preferences survive reload and safely recover from invalid or blocked storage',()=>{
  let json;const storage={getItem:()=>json,setItem:(key,value)=>json=value};
  const settings={...defaultSettings(),color:4,shape_sphere:false,variation:65};
  const orbit={yaw:1.2,pitch:.6,distance:39,target:{toArray:()=>[1,2,3]}};
  writePreferences(storage,settings,{...exportDefaults,samples:4096},orbit);
  const saved=readPreferences(storage);assert.deepEqual(saved.settings,settings);assert.equal(saved.exportOptions.samples,4096);assert.deepEqual(saved.camera.target,[1,2,3]);
  json='{broken';assert.deepEqual(readPreferences(storage).settings,defaultSettings());
  json=JSON.stringify({settings:{count:2e6,radius:-4,color:'Sprinkles'},camera:{target:null}});
  const invalid=readPreferences(storage);assert.equal(invalid.settings.count,1000);assert.equal(invalid.settings.radius,.01);assert.equal(invalid.settings.color,3);assert.equal(invalid.camera,null);
  assert.deepEqual(readPreferences(undefined).settings,defaultSettings());
  assert.doesNotThrow(()=>writePreferences(undefined,settings,exportDefaults,orbit));
});
