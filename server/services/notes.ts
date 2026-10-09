// Internal notes on clients, invoices and submissions. Notes are visible only to staff.

import type { Queryable } from '../db/database';
import { notFound } from '../lib/errors';
import { recordAudit, type Actor } from './audit';
import { requireUuid } from './common';

export type NoteSubject = 'client' | 'invoice' | 'submission';

const TABLES: Record<NoteSubject, string> = {
  client: 'clients',
  invoice: 'invoices',
  submission: 'payment_submissions',
};

export interface NoteRow {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export async function listNotes(db: Queryable, subjectType: NoteSubject, subjectId: string): Promise<NoteRow[]> {
  const { rows } = await db.query<{ id: string; body: string; author_name: string | null; created_at: Date }>(
    `SELECT n.id, n.body, a.display_name AS author_name, n.created_at
       FROM admin_notes n LEFT JOIN admin_users a ON a.id = n.author_id
      WHERE n.subject_type = $1 AND n.subject_id = $2
      ORDER BY n.created_at DESC LIMIT 200`,
    [subjectType, subjectId],
  );
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    authorName: row.author_name,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function addNote(
  db: Queryable,
  subjectType: NoteSubject,
  subjectId: string,
  body: string,
  actor: Actor,
  now: Date,
): Promise<NoteRow> {
  requireUuid(subjectId, 'record');
  const { rowCount } = await db.query(`SELECT 1 FROM ${TABLES[subjectType]} WHERE id = $1`, [subjectId]);
  if (rowCount === 0) throw notFound('That record does not exist.');
  const { rows } = await db.query<{ id: string; created_at: Date }>(
    `INSERT INTO admin_notes (subject_type, subject_id, body, author_id, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [subjectType, subjectId, body, actor.id, now],
  );
  await recordAudit(
    db,
    actor,
    { action: 'note.added', summary: `Added an internal note to a ${subjectType}`, entityType: subjectType, entityId: subjectId, metadata: { noteId: rows[0].id } },
    now,
  );
  return { id: rows[0].id, body, authorName: null, createdAt: new Date(rows[0].created_at).toISOString() };
}
