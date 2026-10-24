/** SHA-256 of `data` (bytes, any typed-array view, an ArrayBuffer, or a UTF-8 string) as 32 bytes. */
export declare function sha256(data: BufferSource | string): Uint8Array;
/** SHA-256 of `data` as 64 lowercase hex characters. */
export declare function sha256Hex(data: BufferSource | string): string;
