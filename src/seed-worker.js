import { makeSeeds } from './config.js';
self.onmessage = async ({data}) => {
  try {
    const seeds=await makeSeeds(data.settings,data.url);
    // WebAssembly.Memory buffers cannot be transferred; transfer one exact-sized copy.
    const buffer=seeds.slice().buffer;
    self.postMessage({buffer},[buffer]);
  } catch(error) { self.postMessage({error:error.message}); }
};
