export function setupGridToggle(button: HTMLButtonElement, onChange: (visible: boolean) => void) {
	let visible = true;
	button.innerHTML =
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/></svg>';
	button.setAttribute('aria-label', 'Grid');

	function setVisible(value: boolean): void {
		visible = value;
		button.classList.toggle('active', visible);
		button.setAttribute('aria-pressed', String(visible));
		button.title = visible ? 'Hide Grid' : 'Show Grid';
	}

	button.onclick = () => {
		setVisible(!visible);
		onChange(visible);
	};
	setVisible(true);
	return { setVisible, isVisible: () => visible };
}
