<script lang="ts">
	import { T, useThrelte } from "@threlte/core";
	import { OrbitControls } from "@threlte/extras";
	import * as THREE from "three";
	import type { Snippet } from "svelte";
	import landGeoJsonRaw from "../assets/ne_110m_land.geojson?raw";
	import type { GlobeMarker, GlobeMarkerTooltipContext } from "./types";
	import GlobeMarkerItem from "./GlobeMarkerItem.svelte";
	import GlobeArc from "./GlobeArc.svelte";

	interface Props {
		radius?: number;
		markers?: GlobeMarker[];
		markerTooltip?: Snippet<[GlobeMarkerTooltipContext]>;
		arcs?: Array<{ from: [number, number]; to: [number, number]; color?: string; speed?: number; transient?: boolean; onfinish?: () => void; _key?: string }>;
	}

	let {
		radius = 3,
		markers = [],
		markerTooltip,
		arcs = [],
	}: Props = $props();

	// --- GeoJSON types & parsing (same as GlobeScene) ---

	type GeoJSONPolygon = { type: "Polygon"; coordinates: number[][][] };
	type GeoJSONMultiPolygon = { type: "MultiPolygon"; coordinates: number[][][][] };
	type GeoJSONGeometry = GeoJSONPolygon | GeoJSONMultiPolygon;
	type GeoJSONFeature = { type: "Feature"; geometry: GeoJSONGeometry | null };
	type GeoJSONFeatureCollection = { type: "FeatureCollection"; features: GeoJSONFeature[] };
	type SphericalPoint = [lon: number, lat: number];

	interface BoundingBox {
		minLon: number; maxLon: number; minLat: number; maxLat: number;
	}

	interface ParsedPolygon {
		rings: SphericalPoint[][];
		bbox: BoundingBox;
	}

	const DEG2RAD = Math.PI / 180;
	const EPSILON = 1e-9;

	const landPolygons = parseLandPolygons(landGeoJsonRaw);

	const initialCameraPosition = { x: 0, y: 0, z: 8 };

	// Set scene background to Win98 silver
	const { scene } = useThrelte();
	scene.background = new THREE.Color("#c0c0c0");

	// --- Voxel generation ---

	const GRID_RADIUS = 20;
	const cubeSize = radius / GRID_RADIUS;

	interface VoxelData {
		landMatrices: Float32Array;
		landCount: number;
		oceanMatrices: Float32Array;
		oceanCount: number;
	}

	let voxelData = $derived.by(() => {
		return generateVoxelSphere(radius, GRID_RADIUS);
	});

	const landColor = new THREE.Color("#008000");
	const oceanColor = new THREE.Color("#000080");
	const boxGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
	const landMaterial = new THREE.MeshBasicMaterial({ color: landColor });
	const oceanMaterial = new THREE.MeshBasicMaterial({ color: oceanColor });

	function generateVoxelSphere(r: number, gridR: number): VoxelData {
		const landPositions: THREE.Matrix4[] = [];
		const oceanPositions: THREE.Matrix4[] = [];
		const scale = r / gridR;
		const dummy = new THREE.Object3D();

		for (let gx = -gridR; gx <= gridR; gx++) {
			for (let gy = -gridR; gy <= gridR; gy++) {
				for (let gz = -gridR; gz <= gridR; gz++) {
					const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
					// Only shell voxels (surface of sphere)
					if (dist < gridR - 1 || dist > gridR) continue;

					const wx = gx * scale;
					const wy = gy * scale;
					const wz = gz * scale;

					dummy.position.set(wx, wy, wz);
					dummy.updateMatrix();

					const { lon, lat } = cartesianToLonLat(wx, wy, wz);
					if (isPointOnLand(lon, lat)) {
						landPositions.push(dummy.matrix.clone());
					} else {
						oceanPositions.push(dummy.matrix.clone());
					}
				}
			}
		}

		const landMatrices = new Float32Array(landPositions.length * 16);
		for (let i = 0; i < landPositions.length; i++) {
			landPositions[i].toArray(landMatrices, i * 16);
		}

		const oceanMatrices = new Float32Array(oceanPositions.length * 16);
		for (let i = 0; i < oceanPositions.length; i++) {
			oceanPositions[i].toArray(oceanMatrices, i * 16);
		}

		return {
			landMatrices,
			landCount: landPositions.length,
			oceanMatrices,
			oceanCount: oceanPositions.length,
		};
	}

	function applyMatrices(mesh: THREE.InstancedMesh, matrices: Float32Array, count: number) {
		const mat = new THREE.Matrix4();
		for (let i = 0; i < count; i++) {
			mat.fromArray(matrices, i * 16);
			mesh.setMatrixAt(i, mat);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}

	// --- Coordinate helpers (same as GlobeScene) ---

	function cartesianToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
		const r = Math.sqrt(x * x + y * y + z * z);
		if (r === 0) return { lon: 0, lat: 0 };
		const lat = Math.asin(Math.min(1, Math.max(-1, y / r)));
		const lon = Math.atan2(x, z);
		return { lon, lat };
	}

	function lonLatToCartesian(lon: number, lat: number, r: number) {
		const lonRad = lon * DEG2RAD;
		const latRad = lat * DEG2RAD;
		const y = r * Math.sin(latRad);
		const rXZ = r * Math.cos(latRad);
		const x = rXZ * Math.sin(lonRad);
		const z = rXZ * Math.cos(lonRad);
		return { x, y, z };
	}

	// --- GeoJSON land detection (same as GlobeScene) ---

	function parseLandPolygons(raw: string): ParsedPolygon[] {
		try {
			const collection = JSON.parse(raw) as GeoJSONFeatureCollection;
			return extractPolygons(collection);
		} catch (error) {
			console.warn("BlocksGlobe: failed to parse land GeoJSON", error);
			return [];
		}
	}

	function extractPolygons(collection: GeoJSONFeatureCollection): ParsedPolygon[] {
		const polygons: ParsedPolygon[] = [];
		for (const feature of collection.features ?? []) {
			const geometry = feature.geometry;
			if (!geometry) continue;
			if (geometry.type === "Polygon") {
				const polygon = convertPolygon(geometry.coordinates);
				if (polygon) polygons.push(polygon);
				continue;
			}
			if (geometry.type === "MultiPolygon") {
				for (const coords of geometry.coordinates) {
					const polygon = convertPolygon(coords);
					if (polygon) polygons.push(polygon);
				}
			}
		}
		return polygons;
	}

	function convertPolygon(rings: number[][][]): ParsedPolygon | null {
		const converted = rings
			.map((ring) =>
				ring.map(([lon, lat]) => [lon * DEG2RAD, lat * DEG2RAD] as SphericalPoint),
			)
			.filter((ring) => ring.length >= 3);
		if (!converted.length) return null;
		return { rings: converted, bbox: computeBoundingBox(converted[0]) };
	}

	function computeBoundingBox(ring: SphericalPoint[]): BoundingBox {
		const bbox: BoundingBox = {
			minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity,
		};
		for (const [lon, lat] of ring) {
			bbox.minLon = Math.min(bbox.minLon, lon);
			bbox.maxLon = Math.max(bbox.maxLon, lon);
			bbox.minLat = Math.min(bbox.minLat, lat);
			bbox.maxLat = Math.max(bbox.maxLat, lat);
		}
		return bbox;
	}

	function isPointOnLand(lon: number, lat: number): boolean {
		for (const polygon of landPolygons) {
			if (!isWithinBounds(lon, lat, polygon.bbox)) continue;
			if (isPointInsidePolygon(lon, lat, polygon.rings)) return true;
		}
		return false;
	}

	function isWithinBounds(lon: number, lat: number, bbox: BoundingBox): boolean {
		return (
			lon >= bbox.minLon - EPSILON &&
			lon <= bbox.maxLon + EPSILON &&
			lat >= bbox.minLat - EPSILON &&
			lat <= bbox.maxLat + EPSILON
		);
	}

	function isPointInsidePolygon(lon: number, lat: number, rings: SphericalPoint[][]): boolean {
		if (!rings.length) return false;
		if (!isPointInRing(lon, lat, rings[0])) return false;
		for (let i = 1; i < rings.length; i++) {
			if (isPointInRing(lon, lat, rings[i])) return false;
		}
		return true;
	}

	function isPointInRing(lon: number, lat: number, ring: SphericalPoint[]): boolean {
		let inside = false;
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const xi = ring[i][0];
			const yi = ring[i][1];
			const xj = ring[j][0];
			const yj = ring[j][1];
			const denom = yj - yi;
			if (Math.abs(denom) < EPSILON) continue;
			const intersects =
				yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / denom + xi;
			if (intersects) inside = !inside;
		}
		return inside;
	}
</script>

<T.PerspectiveCamera
	makeDefault
	position={[initialCameraPosition.x, initialCameraPosition.y, initialCameraPosition.z]}
>
	<OrbitControls
		enableDamping
		autoRotate
		autoRotateSpeed={1.5}
		minPolarAngle={0}
		maxPolarAngle={Math.PI}
		enableZoom={false}
		oncreate={(c) => {
			c.target.set(0, 0, 0);
			c.update();
		}}
	/>
</T.PerspectiveCamera>

<T.AmbientLight intensity={1.0} />

<T.Group>
	{#if voxelData.landCount > 0}
		{#key voxelData.landCount}
			<T.InstancedMesh
				args={[boxGeometry, landMaterial, voxelData.landCount]}
				oncreate={(mesh) => applyMatrices(mesh, voxelData.landMatrices, voxelData.landCount)}
			/>
		{/key}
	{/if}

	{#if voxelData.oceanCount > 0}
		{#key voxelData.oceanCount}
			<T.InstancedMesh
				args={[boxGeometry, oceanMaterial, voxelData.oceanCount]}
				oncreate={(mesh) => applyMatrices(mesh, voxelData.oceanMatrices, voxelData.oceanCount)}
			/>
		{/key}
	{/if}

	{#each markers as marker, i (i)}
		{@const pos = lonLatToCartesian(marker.location[1], marker.location[0], radius)}
		<GlobeMarkerItem
			{marker}
			index={i}
			position={[pos.x, pos.y, pos.z]}
			tooltip={markerTooltip}
		/>
	{/each}

	{#each arcs as arc, i (arc._key || i)}
		<GlobeArc
			from={arc.from}
			to={arc.to}
			{radius}
			color={arc.color || "#000080"}
			speed={arc.speed || 1.0}
			transient={arc.transient || false}
			onfinish={arc.onfinish}
		/>
	{/each}
</T.Group>
