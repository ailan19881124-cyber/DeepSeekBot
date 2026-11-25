import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { atomicWriteFile } from '../fs/atomic-write.js';
import { resolveMemoryPath } from './jail.js';

const idSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u);
const text = (max: number) => z.string().trim().min(1).max(max);
const workerSchema = z.strictObject({
  id: idSchema,
  name: text(120),
  persona: text(12_000),
  model: z.union([z.literal('default'), z.strictObject({ provider: text(200), model: text(200) })]),
  skills: z
    .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u))
    .max(100)
    .optional(),
});

export type WorkerTemplate = z.infer<typeof workerSchema>;

export function parseWorker(value: unknown): WorkerTemplate {
  const result = workerSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      'Invalid worker template: ' +
        result.error.issues.map((issue) => issue.path.join('.') || 'template').join(', '),
    );
  return result.data;
}

export function parseWorkerFile(file: string, content: string): WorkerTemplate {
  const extension = extname(file).toLowerCase();
  if (extension === '.json') return parseWorker(JSON.parse(content));
  const document = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(content);
  if (extension !== '.md' || !document)
    throw new Error('Use a JSON worker or Markdown with YAML front matter and a persona body.');
  const header: unknown = parse(document[1]!);
  if (
    !header ||
    typeof header !== 'object' ||
    Array.isArray(header) ||
    Object.hasOwn(header, 'persona')
  )
    throw new Error('Worker Markdown must have a metadata mapping and use its body for persona.');
  return parseWorker({ ...header, persona: document[2] });
}

function workerId(value: unknown): string {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new Error('Invalid worker id.');
  return result.data;
}

function directory(root: string): string {
  const dir = resolveMemoryPath(root, 'workers');
  const entry = lstatSync(dir, { throwIfNoEntry: false });
  if (entry && !entry.isDirectory()) throw new Error('workers must be a directory in Bot Memory.');
  return dir;
}

function workerPath(root: string, id: string): string {
  const result = join(directory(root), workerId(id) + '.json');
  const entry = lstatSync(result, { throwIfNoEntry: false });
  if (entry && !entry.isFile()) throw new Error('Worker template must be a regular file.');
  return result;
}

export function readWorker(root: string | undefined, id: string): WorkerTemplate {
  workerId(id);
  if (!root) throw new Error('Bot Memory is unavailable.');
  const path = workerPath(root, id);
  if (!lstatSync(path, { throwIfNoEntry: false })) throw new Error('Unknown worker: ' + id);
  const worker = parseWorker(JSON.parse(readFileSync(path, 'utf8')));
  if (worker.id !== id) throw new Error('Worker id does not match its file name: ' + id);
  return worker;
}

export function listWorkers(root: string): WorkerTemplate[] {
  const dir = directory(root);
  if (!lstatSync(dir, { throwIfNoEntry: false })) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readWorker(root, name.slice(0, -5)));
}

export function setWorker(root: string, value: unknown): WorkerTemplate {
  const worker = parseWorker(value);
  const path = workerPath(root, worker.id);
  mkdirSync(directory(root), { recursive: true });
  atomicWriteFile(path, JSON.stringify(worker, null, 2) + '\n');
  return worker;
}

export function removeWorker(root: string, id: string): boolean {
  const path = workerPath(root, id);
  if (!lstatSync(path, { throwIfNoEntry: false })) return false;
  rmSync(path);
  return true;
}

export function appendWorkerPrompt(prompt: string, workerPrompt: string | undefined): string {
  return workerPrompt === undefined ? prompt : prompt + '\n\n' + workerPrompt;
}

export function renderWorkerPrompt(worker: WorkerTemplate): string {
  return [
    '## Assignment worker: ' + worker.name,
    worker.persona,
    ...(worker.skills?.length
      ? ['Suggested Bot Memory skills: ' + worker.skills.join(', ') + '.']
      : []),
  ].join('\n\n');
}
