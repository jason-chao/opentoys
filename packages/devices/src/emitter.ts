// A minimal typed event emitter. A listener that throws does not stop the others (nor the output loop).

export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
	private listeners = new Map<keyof Events, Set<Listener<never>>>();

	/** Subscribe; returns the function that unsubscribes. */
	on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
		let set = this.listeners.get(type);
		if (!set) this.listeners.set(type, (set = new Set()));
		set.add(fn as Listener<never>);
		return () => {
			set.delete(fn as Listener<never>);
		};
	}

	protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
		const set = this.listeners.get(type);
		if (!set) return;
		for (const fn of [...set]) {
			try {
				(fn as Listener<Events[K]>)(payload);
			} catch (e) {
				console.error(`listener for ${String(type)} failed`, e);
			}
		}
	}
}
