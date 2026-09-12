import wabtFactory from 'wabt';
import { readFile, writeFile } from 'node:fs/promises';
const wabt = await wabtFactory();
const mod = wabt.parseWat('seed.wat', await readFile(new URL('../wasm/seed.wat', import.meta.url), 'utf8'));
mod.validate();
await writeFile(new URL('../public/seed.wasm', import.meta.url), mod.toBinary({ canonicalize_lebs: true }).buffer);
mod.destroy();
console.log('Built public/seed.wasm');
