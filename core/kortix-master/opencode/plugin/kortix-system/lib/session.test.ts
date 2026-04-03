import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Session } from "@opencode-ai/sdk"

const tempRoots: string[] = []
const originalStorageBase = process.env.OPENCODE_STORAGE_BASE

afterEach(() => {
	if (originalStorageBase === undefined) delete process.env.OPENCODE_STORAGE_BASE
	else process.env.OPENCODE_STORAGE_BASE = originalStorageBase
	for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStorage(): { storageBase: string; dbPath: string } {
	const root = mkdtempSync(path.join(tmpdir(), "kortix-session-test-"))
	tempRoots.push(root)
	const storageBase = path.join(root, ".local", "share", "opencode")
	mkdirSync(storageBase, { recursive: true })
	return { storageBase, dbPath: path.join(storageBase, "opencode.db") }
}

function seedDb(dbPath: string): void {
	const db = new Database(dbPath)
	db.exec(`
		CREATE TABLE session (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			parent_id TEXT,
			slug TEXT NOT NULL,
			directory TEXT NOT NULL,
			title TEXT NOT NULL,
			version TEXT NOT NULL,
			share_url TEXT,
			summary_additions INTEGER,
			summary_deletions INTEGER,
			summary_files INTEGER,
			summary_diffs TEXT,
			revert TEXT,
			permission TEXT,
			time_created INTEGER NOT NULL,
			time_updated INTEGER NOT NULL,
			time_compacting INTEGER,
			time_archived INTEGER,
			workspace_id TEXT
		);
		CREATE TABLE message (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			time_created INTEGER NOT NULL,
			time_updated INTEGER NOT NULL,
			data TEXT NOT NULL
		);
		CREATE TABLE part (
			id TEXT PRIMARY KEY,
			message_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			time_created INTEGER NOT NULL,
			time_updated INTEGER NOT NULL,
			data TEXT NOT NULL
		);
	`)
	db.query(`INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
		"ses_root", "global", null, "root", "/tmp/project", "Hermes comparison", "1", null, 1, 0, 1, null, null, null, 1000, 2000, null, null, null,
	)
	db.query(`INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
		"ses_child", "global", "ses_root", "child", "/tmp/project", "Hermes comparison continued", "1", null, 1, 0, 1, null, null, null, 3000, 4000, null, null, null,
	)
	db.query(`INSERT INTO message VALUES (?,?,?,?,?)`).run(
		"msg_1", "ses_root", 1100, 1100, JSON.stringify({ role: "user", content: "Please compare Hermes Agent vs Kortix memory systems." }),
	)
	db.query(`INSERT INTO part VALUES (?,?,?,?,?,?)`).run(
		"prt_1", "msg_1", "ses_root", 1200, 1200, JSON.stringify({ type: "text", text: "Session lineage should be resolved before summarization." }),
	)
	db.close()
}

describe("session helpers", () => {
	test("searchSessions returns session-level hits with reason and snippet", async () => {
		const { storageBase, dbPath } = makeStorage()
		seedDb(dbPath)
		process.env.OPENCODE_STORAGE_BASE = storageBase
		const { searchSessions } = await import(`./session.ts?search=${Date.now()}`)
		const hits = searchSessions("Hermes Agent", 5)
		expect(hits.length).toBe(1)
		expect(hits[0]?.id).toBe("ses_root")
		expect(hits[0]?.reason).toContain("message")
		expect(hits[0]?.snippet).toContain("Hermes Agent vs Kortix")
	})

	test("buildSessionLineage formats parent chain", async () => {
		const { buildSessionLineage } = await import(`./session.ts?lineage=${Date.now()}`)
		const sessions = [
			{ id: "ses_root", title: "Root", parentID: null, time: { created: 1000, updated: 2000 } },
			{ id: "ses_child", title: "Child", parentID: "ses_root", time: { created: 3000, updated: 4000 } },
		] as unknown as Session[]
		const output = buildSessionLineage(sessions, "ses_child")
		expect(output).toContain("=== SESSION LINEAGE ===")
		expect(output).toContain("ses_root")
		expect(output).toContain("ses_child")
		expect(output).toContain("[target]")
	})
})
