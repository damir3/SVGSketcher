import { setGeometryKernel } from './index';
import { createWasmGeometryKernel, type WasmKernelBindings } from './wasm';

/** Load and install the Rust/WASM geometry kernel. */
export async function initializeGeometryKernel(): Promise<void> {
	// Resolve against the page, not the compiled importer in Vite's assets/ directory.
	const moduleUrl = new URL(`${import.meta.env.BASE_URL}kernel/sketcher_wasm.js`, document.baseURI).href;
	const bindings = (await import(/* @vite-ignore */ moduleUrl)) as WasmKernelBindings & {
		default(): Promise<unknown>;
	};
	await bindings.default();
	setGeometryKernel(createWasmGeometryKernel(bindings));
}
