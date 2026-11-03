export interface IToolPanel {
	render(): string;
	bindEvents(container: HTMLElement): void;
	handleKeyDown?(e: KeyboardEvent): boolean;
}
