// The server of the UI, read from the outside (plan/types/PLAN.md section 7): a test starts it
// on the dir of a harness project, asks its HTTP API with the key cookie, and stops it. The
// SQL tables that the store writes for readers are read only.
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { startServer } from './code.js'

export const dbOf = (p) => join(p.dir, '.work', 'aristoteles.db')

// The page acts as the person that git names in the dir, and shows only that person's items
// (ruling 10.8, B7): a test of the page makes the dir a repo of Nanda, the person of the harness.
export function gitPerson(p, name = 'Nanda') {
  for (const args of [['init', '-q'], ['config', 'user.name', name]]) {
    Bun.spawnSync(['git', '-C', p.dir, ...args], { env: process.env })
  }
}

// One server for a block of reads. Its clock is the fake clock of the harness (the time of the
// last act), or the time that a test names; stop() always runs, also when a read fails.
export async function withServer(p, use, at) {
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: dbOf(p) }, clock: () => at ?? p.now() })
  const cookie = `aristoteles-${s.port}=${s.key}`
  const origin = `http://127.0.0.1:${s.port}`
  const get = async (path) => (await fetch(`${origin}${path}`, { headers: { cookie } })).json()
  // An act of the person on the page: it needs the key and the page's own origin.
  const post = async (act, body = {}) => {
    const headers = { cookie, origin, 'content-type': 'application/json' }
    const res = await fetch(`${origin}/api/act`, { method: 'POST', headers, body: JSON.stringify({ act, ...body }) })
    return res.json()
  }
  try {
    return await use({ get, post })
  } finally {
    s.stop()
  }
}

// One read: GET a path of the API.
export const api = (p, path, at) => withServer(p, (s) => s.get(path), at)

// The panel of a task, the canvas of a project, and the Diff of a file of a task.
export const panel = (p, task, at) => api(p, `/api/task/${task}`, at)
export const canvas = (p, id, at) => api(p, `/api/project/${id}`, at)
export const diffOf = async (p, task, file) => (await api(p, `/api/diff/${task}?file=${file}`)).diff

// The store's tables for readers, read only; the caller closes it.
export const tables = (p) => new Database(dbOf(p), { readonly: true })

// An act of the person on the page (POST /api/act), and the settings that the page reads.
export const act = (p, name, body) => withServer(p, (s) => s.post(name, body))
export const settingsOf = async (p) => (await api(p, '/api/dir')).settings
