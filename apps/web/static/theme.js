// Applies the stored colour mode before the first paint (see src/lib/app/theme.ts, which owns the logic).
(function () {
	try {
		var t = localStorage.getItem('opentoys.theme');
		if (t === 'dark') t = 'ember';
		if (t === 'light') t = 'dawn';
		if (t === 'ember' || t === 'dawn' || t === 'tide' || t === 'silk') document.documentElement.dataset.theme = t;
	} catch {
		// no storage: the page follows the system
	}
})();
