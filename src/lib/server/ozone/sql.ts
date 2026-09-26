import { pool } from '$lib/server/db';
import type { Sql } from '$engine/types.js';

/** The engine's minimal SQL interface over the app's pg pool. */
export const sql: Sql = pool as unknown as Sql;
