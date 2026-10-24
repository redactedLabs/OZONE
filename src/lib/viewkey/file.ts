/**
 * Reading a view-key file in the browser (errata E-66 (1)): at most 1 MiB, UTF-8, one line of JSON.
 * The text is read locally (File API or paste) and handed to the viewer in this browser only; this
 * module never sends, stores or logs it. The authoritative parser is vault-core's (`openViewKey`): it
 * refuses unknown and secret-named members, other shapes, non-canonical text and a wrong checksum.
 */
import { MAX_FILE_BYTES } from './config';

export class ViewFileError extends Error {
	constructor(
		readonly code: 'FILE_TOO_LARGE' | 'FILE_EMPTY' | 'FILE_NOT_TEXT' | 'NOT_A_VIEW_KEY' | 'LOOKS_LIKE_A_PHRASE',
		message: string
	) {
		super(message);
		this.name = 'ViewFileError';
	}
}

const decoder = () => new TextDecoder('utf-8', { fatal: true });

/** The text of a picked file; the size is checked before anything is read. */
export async function readViewKeyFile(file: Blob): Promise<string> {
	if (file.size > MAX_FILE_BYTES) throw new ViewFileError('FILE_TOO_LARGE', 'A view-key file is at most 1 MiB.');
	if (file.size === 0) throw new ViewFileError('FILE_EMPTY', 'The file is empty.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	let text: string;
	try {
		text = decoder().decode(bytes);
	} catch {
		throw new ViewFileError('FILE_NOT_TEXT', 'This is not a text file. A view key is one line of JSON.');
	}
	return checkViewKeyText(text);
}

/** Checks pasted or read text before the viewer sees it; returns it unchanged. */
export function checkViewKeyText(text: string): string {
	if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new ViewFileError('FILE_TOO_LARGE', 'A view-key file is at most 1 MiB.');
	const t = text.trim();
	if (!t) throw new ViewFileError('FILE_EMPTY', 'The file is empty.');
	// A recovery phrase pasted by mistake: refuse before anything else looks at it.
	if (/^[a-z]+(\s+[a-z]+){11,}$/i.test(t)) {
		throw new ViewFileError('LOOKS_LIKE_A_PHRASE', 'This looks like a recovery phrase, not a view key. Never share a phrase.');
	}
	if (!t.startsWith('{')) throw new ViewFileError('NOT_A_VIEW_KEY', 'This is not a view-key file. A view key is one line of JSON.');
	return text;
}

/** The `deployment_id` a view-key file names (64 hex), or null when it names none. */
export function fileDeploymentId(text: string): string | null {
	try {
		const j = JSON.parse(text);
		const id = j && typeof j === 'object' ? (j as Record<string, unknown>).deployment_id : undefined;
		return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
	} catch {
		return null;
	}
}
