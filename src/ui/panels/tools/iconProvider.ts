export type ToolIconProvider = (name: string) => string;

let globalToolIconProvider: ToolIconProvider = () => '';

export function setToolIconProvider(provider: ToolIconProvider): void {
	globalToolIconProvider = provider;
}

export function getToolIcon(name: string): string {
	return globalToolIconProvider(name);
}
