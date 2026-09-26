/**
 * Global (not per-client) in-memory rate limit for write endpoints. Ozone
 * does not process or store client IPs, so abuse control is a coarse cap
 * per serverless instance.
 */
export function globalThrottle(max: number, windowMs = 60_000) {
	let start = 0;
	let count = 0;
	return (): boolean => {
		const now = Date.now();
		if (now - start > windowMs) {
			start = now;
			count = 0;
		}
		return ++count <= max;
	};
}
