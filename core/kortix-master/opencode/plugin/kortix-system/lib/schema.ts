/**
 * Self-healing SQLite schema utility.
 *
 * Instead of fragile ALTER TABLE ADD/DROP try/catch migrations,
 * this compares the desired schema against the actual table and
 * rebuilds atomically when they drift.
 */

import { Database } from "bun:sqlite"

export interface ColumnDef {
	name: string
	type: string // e.g. "TEXT", "INTEGER"
	notNull: boolean
	defaultValue: string | null // e.g. "''" or "'medium'" or null
	primaryKey: boolean
	unique?: boolean // UNIQUE constraint — PRAGMA table_info doesn't report it, but CREATE TABLE / rebuild will enforce it
}

interface PragmaColumn {
	cid: number
	name: string
	type: string
	notnull: number // 0 or 1
	dflt_value: string | null
	pk: number // 0 or 1
}

/**
 * Ensures a table matches the desired schema. Self-healing:
 * - If table doesn't exist → create it
 * - If table exists with correct schema → no-op
 * - If table exists with wrong schema → rebuild (create temp → copy data → drop old → rename)
 *
 * Data in columns that exist in both old and new schemas is preserved.
 * Columns only in old schema are dropped. Columns only in new schema get defaults.
 */
export function ensureSchema(db: Database, table: string, columns: ColumnDef[]): void {
	const actual = db.prepare(`PRAGMA table_info(${table})`).all() as PragmaColumn[]

	// Table doesn't exist — create fresh
	if (actual.length === 0) {
		db.exec(buildCreateSQL(table, columns))
		console.log(`[schema] ${table}: created`)
		return
	}

	// Compare actual vs desired
	if (schemasMatch(actual, columns)) {
		return // no-op — schemas match
	}

	// Schemas differ — rebuild
	const oldColNames = new Set(actual.map(c => c.name))
	const newColNames = new Set(columns.map(c => c.name))
	const intersecting = columns.filter(c => oldColNames.has(c.name)).map(c => c.name)

	const dropped = actual.filter(c => !newColNames.has(c.name)).map(c => c.name)
	const added = columns.filter(c => !oldColNames.has(c.name)).map(c => c.name)

	const tmpTable = `${table}_schema_rebuild`

	const rebuild = db.transaction(() => {
		// Drop any leftover temp table from a previous failed rebuild
		db.exec(`DROP TABLE IF EXISTS ${tmpTable}`)
		db.exec(buildCreateSQL(tmpTable, columns))

		if (intersecting.length > 0) {
			// Build INSERT that covers ALL new columns, using defaults for added ones
			const allColNames = columns.map(c => c.name)
			const selectExprs = columns.map(c => {
				if (oldColNames.has(c.name)) return c.name
				// New column — provide a fallback value for the SELECT
				if (c.defaultValue !== null) return `${c.defaultValue} AS ${c.name}`
				if (!c.notNull) return `NULL AS ${c.name}`
				// NOT NULL with no explicit default — use type-appropriate zero value
				if (c.type.toUpperCase() === "INTEGER") return `0 AS ${c.name}`
				return `'' AS ${c.name}`
			})
			db.exec(`INSERT INTO ${tmpTable} (${allColNames.join(", ")}) SELECT ${selectExprs.join(", ")} FROM ${table}`)
		}

		db.exec(`DROP TABLE ${table}`)
		db.exec(`ALTER TABLE ${tmpTable} RENAME TO ${table}`)
	})

	rebuild()

	const changes: string[] = []
	if (dropped.length) changes.push(`dropped [${dropped.join(", ")}]`)
	if (added.length) changes.push(`added [${added.join(", ")}]`)
	if (!dropped.length && !added.length) changes.push("column definition changed")
	console.log(`[schema] ${table}: rebuilt — ${changes.join(", ")}`)
}

/** Build a CREATE TABLE statement from column definitions */
function buildCreateSQL(table: string, columns: ColumnDef[]): string {
	const colDefs = columns.map(c => {
		const parts = [c.name, c.type.toUpperCase()]
		if (c.primaryKey) parts.push("PRIMARY KEY")
		if (c.notNull && !c.primaryKey) parts.push("NOT NULL")
		if (c.unique && !c.primaryKey) parts.push("UNIQUE")
		if (c.defaultValue !== null) parts.push(`DEFAULT ${c.defaultValue}`)
		return parts.join(" ")
	})
	return `CREATE TABLE ${table} (${colDefs.join(", ")})`
}

/**
 * Compare actual PRAGMA table_info output against desired ColumnDef[].
 * Returns true only if they match perfectly.
 */
function schemasMatch(actual: PragmaColumn[], desired: ColumnDef[]): boolean {
	if (actual.length !== desired.length) return false

	// Build a map of actual columns by name for comparison
	const actualMap = new Map<string, PragmaColumn>()
	for (const col of actual) actualMap.set(col.name, col)

	for (const want of desired) {
		const got = actualMap.get(want.name)
		if (!got) return false

		// Type comparison (case-insensitive)
		if (got.type.toUpperCase() !== want.type.toUpperCase()) return false

		// NOT NULL comparison — PRAGMA reports pk columns as notnull=0 even though they're implicitly NOT NULL
		if (!want.primaryKey) {
			if ((got.notnull === 1) !== want.notNull) return false
		}

		// PRIMARY KEY comparison
		if ((got.pk === 1) !== want.primaryKey) return false

		// Default value comparison
		if (!defaultsMatch(got.dflt_value, want.defaultValue)) return false
	}

	return true
}

/**
 * Compare PRAGMA's dflt_value (which is a string like "''" or "'medium'" or NULL)
 * against our ColumnDef defaultValue.
 */
function defaultsMatch(pragmaDefault: string | null, desiredDefault: string | null): boolean {
	// Both null
	if (pragmaDefault === null && desiredDefault === null) return true
	// One null, other not
	if (pragmaDefault === null || desiredDefault === null) return false
	// String comparison (PRAGMA returns values like "''" or "'medium'")
	return pragmaDefault === desiredDefault
}
