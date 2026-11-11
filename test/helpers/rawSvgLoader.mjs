import { readFile } from 'node:fs/promises';

export async function load(url, context, nextLoad) {
	const resource = new URL(url);
	if (resource.protocol === 'file:' && resource.pathname.endsWith('.svg') && resource.search === '?raw') {
		resource.search = '';
		return { format: 'module', source: `export default ${JSON.stringify(await readFile(resource, 'utf8'))};`, shortCircuit: true };
	}
	return nextLoad(url, context);
}
