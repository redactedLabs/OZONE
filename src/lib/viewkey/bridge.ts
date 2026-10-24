/**
 * The page side of the viewer Worker: requests by id, and the answers to the Worker's chain reads
 * (from `EnvProvider`, i.e. the page's two RPC sources).
 */
import type { DeploymentConfig } from './config';
import type { EnvProvider, FromWorker, Opened, ToWorker, ViewError } from './protocol';

export interface Port {
	postMessage(m: ToWorker, transfer?: Transferable[]): void;
	onmessage: ((e: { data: FromWorker }) => void) | null;
	terminate?(): void;
}

/** A request without its id (distributed over the union). */
type Request = ToWorker extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

export class ViewerCallError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'ViewerCallError';
	}
}

export class ViewerBridge {
	private seq = 0;
	private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
	env: EnvProvider | null = null;
	private markReady!: () => void;
	/** Resolved when the Worker has set its handler (`{kind: 'ready'}`); nothing is sent before. */
	readonly ready = new Promise<void>((resolve) => (this.markReady = resolve));

	constructor(private readonly port: Port) {
		port.onmessage = (e) => void this.receive(e.data);
	}

	private async request<T>(m: Request, transfer?: Transferable[]): Promise<T> {
		await this.ready;
		const id = ++this.seq;
		return new Promise<T>((resolve, reject) => {
			this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
			this.port.postMessage({ ...m, id } as ToWorker, transfer);
		});
	}

	private async receive(m: FromWorker): Promise<void> {
		if (m.kind === 'ready') {
			this.markReady();
			return;
		}
		if (m.kind === 'result') {
			const w = this.waiting.get(m.id);
			if (!w) return;
			this.waiting.delete(m.id);
			if (m.error) w.reject(new ViewerCallError(m.error.code, m.error.message));
			else w.resolve(m.result);
			return;
		}
		// a chain read the Worker needs
		let reply: { result?: unknown; error?: ViewError };
		try {
			if (!this.env) throw new ViewerCallError('NO_CHAIN', 'no chain sources for this deployment');
			if (m.fn === 'height') reply = { result: await this.env.height() };
			else if (m.fn === 'feedRecords') reply = { result: await this.env.feedRecords() };
			else if (m.fn === 'balances') reply = { result: await this.env.balances(String(m.args[0])) };
			else throw new ViewerCallError('FORBIDDEN', 'unknown request');
		} catch (e) {
			const err = e as { code?: string; message?: string };
			reply = { error: { code: String(err.code ?? 'CHAIN_UNAVAILABLE'), message: String(err.message ?? e) } };
		}
		this.port.postMessage({ kind: 'env-reply', id: m.id, ...reply });
	}

	init(wasm: ArrayBuffer): Promise<{ version: string }> {
		return this.request({ kind: 'init', wasm }, [wasm]);
	}

	open(file: string, deployments: DeploymentConfig[]): Promise<Opened> {
		return this.request({ kind: 'open', file, deployments });
	}

	call<T>(method: string, ...params: unknown[]): Promise<T> {
		return this.request({ kind: 'call', method, params });
	}

	close(): void {
		for (const w of this.waiting.values()) w.reject(new ViewerCallError('CLOSED', 'closed'));
		this.waiting.clear();
		this.port.onmessage = null;
		this.port.terminate?.();
	}
}
