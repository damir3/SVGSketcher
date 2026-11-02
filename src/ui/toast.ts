export function showToast(msg: string): void {
	if (typeof document === 'undefined') return;
	const existing = document.getElementById('cad-toast');
	if (existing) existing.remove();

	const toast = document.createElement('div');
	toast.id = 'cad-toast';
	toast.className = 'cad-toast';
	toast.textContent = msg;
	document.body.appendChild(toast);

	const timer = setTimeout(() => {
		toast.classList.add('fade-out');
		const timer2 = setTimeout(() => toast.remove(), 300);
		if (typeof (timer2 as any)?.unref === 'function') (timer2 as any).unref();
	}, 2200);
	if (typeof (timer as any)?.unref === 'function') (timer as any).unref();
}
