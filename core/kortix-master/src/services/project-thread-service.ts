import { Database } from 'bun:sqlite'

export interface ProjectThreadClientLike {
  session: {
    create(args: any): Promise<any>
  }
}

export interface ProjectThreadResult {
  projectId: string
  managerSessionId: string
  created: boolean
}

export async function ensureProjectManagerSession(
  db: Database,
  client: ProjectThreadClientLike,
  projectId: string,
): Promise<ProjectThreadResult> {
  db.exec(`CREATE TABLE IF NOT EXISTS session_projects (
    session_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    set_at TEXT NOT NULL
  )`)

  const project = db.prepare('SELECT id, name, manager_session_id FROM projects WHERE id=$id').get({ $id: projectId }) as {
    id: string
    name: string
    manager_session_id?: string | null
  } | null

  if (!project) throw new Error('Project not found')
  if (project.manager_session_id) {
    return {
      projectId: project.id,
      managerSessionId: project.manager_session_id,
      created: false,
    }
  }

  const createdAt = new Date().toISOString()
  const session = await client.session.create({
    body: {
      title: `${project.name} orchestrator`,
    },
  })
  const managerSessionId = session.data?.id
  if (!managerSessionId) throw new Error('Failed to create manager session')

  db.prepare('UPDATE projects SET manager_session_id=$sid WHERE id=$id').run({ $sid: managerSessionId, $id: project.id })
  db.prepare('INSERT OR REPLACE INTO session_projects (session_id, project_id, set_at) VALUES ($sid, $pid, $now)').run({
    $sid: managerSessionId,
    $pid: project.id,
    $now: createdAt,
  })

  return {
    projectId: project.id,
    managerSessionId,
    created: true,
  }
}
