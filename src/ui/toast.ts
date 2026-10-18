export function showToast(msg: string): void {
	const existing = document.getElementById('cad-toast');
	if (existing) existing.remove();

	const toast = document.createElement('div');
	toast.id = 'cad-toast';
	toast.className = 'cad-toast';
	toast.textContent = msg;
	document.body.appendChild(toast);

	setTimeout(() => {
		toast.classList.add('fade-out');
		setTimeout(() => toast.remove(), 300);
	}, 2200);
}
