import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args) {
	const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
	if (result.error) {
		console.error(`Could not run ${command}: ${result.error.message}. See docs/rust-kernel.md for setup.`);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}

const bindgen = process.env.WASM_BINDGEN || 'wasm-bindgen';
run(bindgen, ['--version']);
run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'sketcher-wasm']);
run(bindgen, [
	'target/wasm32-unknown-unknown/release/sketcher_wasm.wasm',
	'--target', 'web', '--out-dir', 'public/kernel', '--out-name', 'sketcher_wasm',
]);
