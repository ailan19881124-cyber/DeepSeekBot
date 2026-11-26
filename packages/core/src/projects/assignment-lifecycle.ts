import type { DatabaseSync } from 'node:sqlite';

export function settleProjectTask(
  db: DatabaseSync,
  sessionId: string,
  state: 'review' | 'failed',
  at: string,
): void {
  db.prepare(`
    UPDATE tasks SET state = ?, updated_at = ?, revision = revision + 1
     WHERE channel_id = ? AND state = 'doing'
  `).run(state, at, sessionId);
}

export function latestProjectAssignmentState(
  db: DatabaseSync,
  sessionId: string,
): 'review' | 'failed' | 'doing' {
  const result = db
    .prepare(`
    SELECT CASE WHEN source_kind = 'assignment-lifecycle'
      THEN json_extract(payload_json, '$.assignmentLifecycle.state')
      ELSE json_extract(payload_json, '$.assignmentReport.state') END AS outcome
    FROM source_events WHERE assignment_session_id = ? AND (
      (source_kind = 'assignment-lifecycle' AND json_extract(payload_json, '$.assignmentLifecycle.state') IN ('completed','failed','cancelled'))
      OR (source_kind = 'assignment-report' AND (
        json_extract(payload_json, '$.assignmentReport.state') = 'failed'
        OR (json_extract(payload_json, '$.assignmentReport.state') = 'completed'
          AND json_extract(payload_json, '$.assignmentReport.turn') IS NULL)
      ))
    ) ORDER BY rowid DESC LIMIT 1
  `)
    .get(sessionId);
  if (result) return result.outcome === 'completed' ? 'review' : 'failed';
  const assignment = db
    .prepare('SELECT activity FROM assignments WHERE session_id = ?')
    .get(sessionId);
  return assignment?.activity === 'error' ? 'failed' : 'doing';
}
