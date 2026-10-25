/**
 * Reading a view-key file (errata E-66 (1): at most 1 MiB) or a history file (errata E-68 (1): at most
 * 16 MiB) in the browser: UTF-8, one line of JSON, told apart by its `version`. The text is read locally
 * (File API or paste) and handed to the viewer in this browser only; this module never sends, stores or
 * logs it. The authoritative parsers are vault-core's (`openViewKey`, `openHistory`): they refuse unknown
 * and secret-named members, other shapes, non-canonical text and a wrong checksum.
 */
import { FILE_VERSIONS, MAX_FILE_BYTES, MAX_HISTORY_BYTES, MAX_VIEW_KEY_BYTES, type FileKind } from './config';

export class ViewFileError extends Error {
	constructor(
		readonly code: 'FILE_TOO_LARGE' | 'FILE_EMPTY' | 'FILE_NOT_TEXT' | 'NOT_A_VIEW_FILE' | 'LOOKS_LIKE_A_PHRASE',
		message: string
	) {
		super(message);
		this.name = 'ViewFileError';
	}
}

const decoder = () => new TextDecoder('utf-8', { fatal: true });

/** The text of a picked file; the size is checked before anything is read. */
export async function readViewFile(file: Blob): Promise<{ text: string; kind: FileKind }> {
	if (file.size > MAX_FILE_BYTES) throw new ViewFileError('FILE_TOO_LARGE', 'A history file is at most 16 MiB, a view key at most 1 MiB.');
	if (file.size === 0) throw new ViewFileError('FILE_EMPTY', 'The file is empty.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	let text: string;
	try {
		text = decoder().decode(bytes);
	} catch {
		throw new ViewFileError('FILE_NOT_TEXT', 'This is not a text file. A view key or a history file is one line of JSON.');
	}
	return checkViewFileText(text);
}

/** Checks pasted or read text before the viewer sees it, and says which file it is; the text is returned unchanged. */
export function checkViewFileText(text: string): { text: string; kind: FileKind } {
	const size = new TextEncoder().encode(text).length;
	if (size > MAX_FILE_BYTES) throw new ViewFileError('FILE_TOO_LARGE', 'A history file is at most 16 MiB, a view key at most 1 MiB.');
	const t = text.trim();
	if (!t) throw new ViewFileError('FILE_EMPTY', 'The file is empty.');
	// A recovery phrase pasted by mistake: refuse before anything else looks at it.
	if (/^[a-z]+(\s+[a-z]+){11,}$/i.test(t)) {
		throw new ViewFileError('LOOKS_LIKE_A_PHRASE', 'This looks like a recovery phrase, not a view key. Never share a phrase.');
	}
	const kind = fileKind(text);
	if (!kind) throw new ViewFileError('NOT_A_VIEW_FILE', 'This is neither a view key nor a history file.');
	if (size > (kind === 'history' ? MAX_HISTORY_BYTES : MAX_VIEW_KEY_BYTES)) {
		throw new ViewFileError('FILE_TOO_LARGE', kind === 'history' ? 'A history file is at most 16 MiB.' : 'A view key is at most 1 MiB.');
	}
	return { text, kind };
}

function members(text: string): Record<string, unknown> | null {
	if (!text.trimStart().startsWith('{')) return null;
	try {
		const j = JSON.parse(text);
		return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Which file this is, by its `version` member (null: neither). */
export function fileKind(text: string): FileKind | null {
	const v = members(text)?.version;
	return typeof v === 'string' && Object.hasOwn(FILE_VERSIONS, v) ? FILE_VERSIONS[v as keyof typeof FILE_VERSIONS] : null;
}

/** The `deployment_id` a file names (64 hex), or null when it names none. */
export function fileDeploymentId(text: string): string | null {
	const id = members(text)?.deployment_id;
	return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
}
