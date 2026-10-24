import { describe, expect, it } from 'vitest';
import { checkViewKeyText, fileDeploymentId, readViewKeyFile, ViewFileError } from './file';
import { fixture } from './__fixtures__/fake-chain';

const code = async (p: Promise<unknown> | (() => unknown)) => {
	try {
		await (typeof p === 'function' ? p() : p);
	} catch (e) {
		return (e as ViewFileError).code;
	}
	return null;
};

describe('view-key file reading', () => {
	it('reads a view-key file unchanged and finds its deployment', async () => {
		const text = await readViewKeyFile(new Blob([fixture.file + '\n']));
		expect(text).toBe(fixture.file + '\n');
		expect(fileDeploymentId(text)).toBe(fixture.deployment_id);
	});

	it('refuses a file over 1 MiB before reading it', async () => {
		let read = false;
		const big = { size: 1024 * 1024 + 2, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) } as unknown as Blob;
		expect(await code(readViewKeyFile(big))).toBe('FILE_TOO_LARGE');
		expect(read).toBe(false);
		expect(await code(() => checkViewKeyText('{' + 'a'.repeat(1024 * 1024 + 1)))).toBe('FILE_TOO_LARGE');
	});

	it('refuses empty, binary and non-JSON input', async () => {
		expect(await code(readViewKeyFile(new Blob([])))).toBe('FILE_EMPTY');
		expect(await code(readViewKeyFile(new Blob([new Uint8Array([0xff, 0xfe, 0x7b])])))).toBe('FILE_NOT_TEXT');
		expect(await code(() => checkViewKeyText('   \n'))).toBe('FILE_EMPTY');
		expect(await code(() => checkViewKeyText('hello there'))).toBe('NOT_A_VIEW_KEY');
	});

	it('refuses a recovery phrase pasted by mistake', async () => {
		const words = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt';
		expect(await code(() => checkViewKeyText(words))).toBe('LOOKS_LIKE_A_PHRASE');
	});

	it('names no deployment for text that is not a view key', () => {
		expect(fileDeploymentId('not json')).toBeNull();
		expect(fileDeploymentId('{"deployment_id":"XYZ"}')).toBeNull();
		expect(fileDeploymentId('[]')).toBeNull();
	});
});
