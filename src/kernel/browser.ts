import { setGeometryKernel } from './index';
import { createWasmGeometryKernel, type WasmKernelBindings } from './wasm';

/** Load the Rust/WASM geometry kernel by default unless explicitly set to 'typescript'. */
export async function initializeGeometryKernel(): Promise<void> {
	if (import.meta.env.VITE_GEOMETRY_KERNEL === 'typescript') return;
	try {
		// Resolve against the page, not the compiled importer in Vite's assets/ directory.
		const moduleUrl = new URL(`${import.meta.env.BASE_URL}kernel/sketcher_wasm.js`, document.baseURI).href;
		const bindings = (await import(/* @vite-ignore */ moduleUrl)) as WasmKernelBindings & {
			default(): Promise<unknown>;
		};
		await bindings.default();
		setGeometryKernel(createWasmGeometryKernel(bindings));
	} catch (error) {
		console.warn('Rust geometry kernel could not load; using TypeScript.', error);
	}
}
