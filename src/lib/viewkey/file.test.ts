import { describe, expect, it } from 'vitest';
import { checkViewFileText, fileDeploymentId, fileKind, readViewFile, ViewFileError } from './file';
import { fixture, historyFixture } from './__fixtures__/fake-chain';

const code = async (p: Promise<unknown> | (() => unknown)) => {
	try {
		await (typeof p === 'function' ? p() : p);
	} catch (e) {
		return (e as ViewFileError).code;
	}
	return null;
};

describe('view-key file reading', () => {
	it('reads a view-key file and a history file unchanged, tells them apart and finds their deployment', async () => {
		const key = await readViewFile(new Blob([fixture.file + '\n']));
		expect(key).toEqual({ text: fixture.file + '\n', kind: 'view_key' });
		expect(fileDeploymentId(key.text)).toBe(fixture.deployment_id);
		const hist = await readViewFile(new Blob([historyFixture.files.default.file]));
		expect(hist).toEqual({ text: historyFixture.files.default.file, kind: 'history' });
		expect(fileDeploymentId(hist.text)).toBe(historyFixture.deployment_id);
		expect(fileKind('{"version":"hops/v1/something-else"}')).toBeNull();
		expect(fileKind('{"version":"toString"}')).toBeNull();
	});

	it('refuses a file over 16 MiB before reading it, and a view key over 1 MiB', async () => {
		let read = false;
		const big = { size: 16 * 1024 * 1024 + 2, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) } as unknown as Blob;
		expect(await code(readViewFile(big))).toBe('FILE_TOO_LARGE');
		expect(read).toBe(false);
		const pad = (version: string, n: number) => `{"version":"${version}","x":"${'a'.repeat(n)}"}`;
		expect(await code(() => checkViewFileText(pad('hops/v1/view-key', 1024 * 1024 + 1)))).toBe('FILE_TOO_LARGE');
		expect(checkViewFileText(pad('hops/v1/history', 1024 * 1024 + 1)).kind).toBe('history');
		expect(await code(() => checkViewFileText(pad('hops/v1/history', 16 * 1024 * 1024 + 1)))).toBe('FILE_TOO_LARGE');
	});

	it('refuses empty, binary and non-JSON input', async () => {
		expect(await code(readViewFile(new Blob([])))).toBe('FILE_EMPTY');
		expect(await code(readViewFile(new Blob([new Uint8Array([0xff, 0xfe, 0x7b])])))).toBe('FILE_NOT_TEXT');
		expect(await code(() => checkViewFileText('   \n'))).toBe('FILE_EMPTY');
		expect(await code(() => checkViewFileText('hello there'))).toBe('NOT_A_VIEW_FILE');
		expect(await code(() => checkViewFileText('{"version":"hops/v1/backup"}'))).toBe('NOT_A_VIEW_FILE');
	});

	it('refuses a recovery phrase pasted by mistake', async () => {
		const words = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt';
		expect(await code(() => checkViewFileText(words))).toBe('LOOKS_LIKE_A_PHRASE');
	});

	it('names no deployment for text that is not a view key', () => {
		expect(fileDeploymentId('not json')).toBeNull();
		expect(fileDeploymentId('{"deployment_id":"XYZ"}')).toBeNull();
		expect(fileDeploymentId('[]')).toBeNull();
	});
});
