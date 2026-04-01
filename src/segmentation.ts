import type { Bindings, SegmentRecord, SegmentCriteria, UserRecord, UserSegmentRecord } from './types'
import { toNumber } from './utils'

export async function createSegment(
  env: Bindings,
  name: string,
  criteria: SegmentCriteria[],
  description?: string
): Promise<SegmentRecord> {
  const id = crypto.randomUUID()
  const criteriaJson = JSON.stringify(criteria)

  await env.DB.prepare(
    'INSERT INTO segments (id, name, description, criteria) VALUES (?, ?, ?, ?)'
  )
    .bind(id, name, description || null, criteriaJson)
    .run()

  return {
    id,
    name,
    description: description || null,
    criteria,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

export async function getSegmentById(env: Bindings, id: string): Promise<SegmentRecord | null> {
  const segment = await env.DB.prepare('SELECT * FROM segments WHERE id = ?').bind(id).first()
  if (!segment) return null

  return {
    id: segment.id as string,
    name: segment.name as string,
    description: segment.description as string | null,
    criteria: JSON.parse(segment.criteria as string) as SegmentCriteria[],
    created_at: segment.created_at as string,
    updated_at: segment.updated_at as string
  }
}

export async function listSegments(env: Bindings): Promise<SegmentRecord[]> {
  const segments = await env.DB.prepare('SELECT * FROM segments ORDER BY created_at DESC').all()
  return segments.results.map(segment => ({
    id: segment.id as string,
    name: segment.name as string,
    description: segment.description as string | null,
    criteria: JSON.parse(segment.criteria as string) as SegmentCriteria[],
    created_at: segment.created_at as string,
    updated_at: segment.updated_at as string
  }))
}

export async function updateSegment(
  env: Bindings,
  id: string,
  updates: { name?: string; description?: string; criteria?: SegmentCriteria[] }
): Promise<SegmentRecord | null> {
  const existing = await getSegmentById(env, id)
  if (!existing) return null

  const newName = updates.name ?? existing.name
  const newDescription = updates.description ?? existing.description
  const newCriteria = updates.criteria ?? existing.criteria
  const criteriaJson = JSON.stringify(newCriteria)

  await env.DB.prepare(
    'UPDATE segments SET name = ?, description = ?, criteria = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  )
    .bind(newName, newDescription, criteriaJson, id)
    .run()

  return {
    ...existing,
    name: newName,
    description: newDescription,
    criteria: newCriteria,
    updated_at: new Date().toISOString()
  }
}

export async function deleteSegment(env: Bindings, id: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM segments WHERE id = ?').bind(id).run()
  return result.meta.changes > 0
}

function matchesCriteria(user: UserRecord, criteria: SegmentCriteria[]): boolean {
  for (const criterion of criteria) {
    const { field, operator, value } = criterion
    const userValue = (user as any)[field]

    switch (operator) {
      case 'eq':
        if (userValue !== value) return false
        break
      case 'gt':
        if (toNumber(userValue) <= toNumber(value)) return false
        break
      case 'lt':
        if (toNumber(userValue) >= toNumber(value)) return false
        break
      case 'gte':
        if (toNumber(userValue) < toNumber(value)) return false
        break
      case 'lte':
        if (toNumber(userValue) > toNumber(value)) return false
        break
      case 'contains':
        if (!String(userValue).includes(String(value))) return false
        break
      case 'in':
        if (!Array.isArray(value) || !value.includes(userValue)) return false
        break
    }
  }
  return true
}

export async function getUsersInSegment(env: Bindings, segmentId: string): Promise<UserRecord[]> {
  const segment = await getSegmentById(env, segmentId)
  if (!segment) return []

  const users = await env.DB.prepare('SELECT * FROM users').all()
  return users.results
    .map(user => user as UserRecord)
    .filter(user => matchesCriteria(user, segment.criteria))
}

export async function refreshUserSegments(env: Bindings, userId: string): Promise<void> {
  // Remove user from all segments
  await env.DB.prepare('DELETE FROM user_segments WHERE user_id = ?').bind(userId).run()

  // Get all segments
  const segments = await listSegments(env)

  // Check which segments the user matches
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRecord>()
  if (!user) return

  for (const segment of segments) {
    if (matchesCriteria(user, segment.criteria)) {
      await env.DB.prepare(
        'INSERT INTO user_segments (user_id, segment_id) VALUES (?, ?)'
      ).bind(userId, segment.id).run()
    }
  }
}

export async function getUserSegments(env: Bindings, userId: string): Promise<SegmentRecord[]> {
  const userSegments = await env.DB.prepare(`
    SELECT s.* FROM segments s
    JOIN user_segments us ON s.id = us.segment_id
    WHERE us.user_id = ?
  `).bind(userId).all()

  return userSegments.results.map(segment => ({
    id: segment.id as string,
    name: segment.name as string,
    description: segment.description as string | null,
    criteria: JSON.parse(segment.criteria as string) as SegmentCriteria[],
    created_at: segment.created_at as string,
    updated_at: segment.updated_at as string
  }))
}