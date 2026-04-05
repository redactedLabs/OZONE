<script lang="ts">
	import { T, useTask } from "@threlte/core";
	import * as THREE from "three";

	interface Props {
		from: [number, number];
		to: [number, number];
		radius: number;
		color?: string;
		opacity?: number;
		speed?: number;
		/** If true, arc disappears after one pass */
		transient?: boolean;
		/** Called when a transient arc finishes */
		onfinish?: () => void;
	}

	let {
		from,
		to,
		radius,
		color = "#6366f1",
		opacity = 0.6,
		speed = 1.0,
		transient = false,
		onfinish,
	}: Props = $props();

	const DEG2RAD = Math.PI / 180;

	function lonLatToVec3(lat: number, lon: number, r: number): THREE.Vector3 {
		const latRad = lat * DEG2RAD;
		const lonRad = lon * DEG2RAD;
		const y = r * Math.sin(latRad);
		const rXZ = r * Math.cos(latRad);
		const x = rXZ * Math.sin(lonRad);
		const z = rXZ * Math.cos(lonRad);
		return new THREE.Vector3(x, y, z);
	}

	function createArcCurve(
		fromCoords: [number, number],
		toCoords: [number, number],
		r: number,
	): THREE.CubicBezierCurve3 {
		const start = lonLatToVec3(fromCoords[0], fromCoords[1], r);
		const end = lonLatToVec3(toCoords[0], toCoords[1], r);

		const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
		const dist = start.distanceTo(end);
		const arcHeight = Math.max(0.3, dist * 0.4);
		mid.normalize().multiplyScalar(r + arcHeight);

		const ctrl1 = new THREE.Vector3().lerpVectors(start, mid, 0.5);
		ctrl1.normalize().multiplyScalar(r + arcHeight * 0.6);
		const ctrl2 = new THREE.Vector3().lerpVectors(mid, end, 0.5);
		ctrl2.normalize().multiplyScalar(r + arcHeight * 0.6);

		return new THREE.CubicBezierCurve3(start, ctrl1, ctrl2, end);
	}

	const curve = $derived(createArcCurve(from, to, radius));
	const curvePoints = $derived(curve.getPoints(48));

	let drawProgress = $state(0);
	let finished = $state(false);
	const TRAIL_LENGTH = 0.3;

	useTask((delta) => {
		if (finished) return;

		drawProgress += delta * speed * 0.5;

		if (drawProgress > 1 + TRAIL_LENGTH + 0.1) {
			if (transient) {
				finished = true;
				onfinish?.();
			} else {
				drawProgress = 0;
			}
		}
	});

	const trailStart = $derived(Math.max(0, drawProgress - TRAIL_LENGTH));

	const arcGeometry = $derived.by(() => {
		if (finished) return null;
		const start = Math.floor(trailStart * curvePoints.length);
		const end = Math.min(Math.floor(drawProgress * curvePoints.length), curvePoints.length);
		if (end <= start + 1) return null;

		const visible = curvePoints.slice(start, end);
		if (visible.length < 2) return null;
		return new THREE.BufferGeometry().setFromPoints(visible);
	});

	const headPos = $derived(
		!finished && drawProgress > 0 && drawProgress <= 1
			? curve.getPoint(Math.min(drawProgress, 1))
			: null
	);
</script>

{#if arcGeometry && !finished}
	<T.Line geometry={arcGeometry}>
		<T.LineBasicMaterial
			{color}
			transparent
			{opacity}
			blending={THREE.AdditiveBlending}
			depthWrite={false}
			toneMapped={false}
		/>
	</T.Line>
{/if}

{#if headPos && !finished}
	<T.Mesh position={[headPos.x, headPos.y, headPos.z]}>
		<T.SphereGeometry args={[0.025, 6, 6]} />
		<T.MeshBasicMaterial
			{color}
			transparent
			opacity={0.9}
			blending={THREE.AdditiveBlending}
			toneMapped={false}
		/>
	</T.Mesh>
{/if}
