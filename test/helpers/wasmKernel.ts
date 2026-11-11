import { readFile } from 'node:fs/promises';
import { setGeometryKernel } from '../../src/kernel/index';
import { createWasmGeometryKernel } from '../../src/kernel/wasm';

// Preloaded in every test worker, so the full editor suite exercises actual WASM.
const bindings = await import('../../public/kernel/sketcher_wasm.js');
await bindings.default({
	module_or_path: await readFile(new URL('../../public/kernel/sketcher_wasm_bg.wasm', import.meta.url)),
});
setGeometryKernel(createWasmGeometryKernel(bindings));
