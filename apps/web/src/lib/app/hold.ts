// A button that repeats while it is held: once at once, then steadily (a Svelte action). Every − and + of a
// level uses it, so a long way can be covered without tapping, one step at a time all the same.
export function hold(node: HTMLButtonElement, run: () => void) {
	let delay: ReturnType<typeof setTimeout> | undefined;
	let repeat: ReturnType<typeof setInterval> | undefined;
	const end = () => {
		clearTimeout(delay);
		clearInterval(repeat);
	};
	const down = (e: PointerEvent) => {
		if (e.button !== 0 || node.disabled) return;
		end();
		run();
		delay = setTimeout(() => (repeat = setInterval(() => (node.disabled ? end() : run()), 130)), 450);
	};
	// A keyboard press (Enter, Space) arrives as a click that no pointer made.
	const click = (e: MouseEvent) => {
		if (e.detail === 0) run();
	};
	const ends = ['pointerup', 'pointerleave', 'pointercancel', 'blur'];
	node.addEventListener('pointerdown', down);
	node.addEventListener('click', click);
	for (const type of ends) node.addEventListener(type, end);
	return {
		update(next: () => void) {
			run = next;
		},
		destroy() {
			end();
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('click', click);
			for (const type of ends) node.removeEventListener(type, end);
		}
	};
}
