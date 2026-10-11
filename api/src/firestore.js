/**
 * The few Firestore operations the API needs, over the REST API with the
 * project's service account (server access, so security rules don't apply).
 */
import { serviceAccountToken } from './google-auth.js';

export const SERVER_TIME = Symbol('serverTime');
export const DELETE = Symbol('delete');

function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
const encodeFields = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v !== 'symbol').map(([k, v]) => [k, encode(v)]));

function decode(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
const decodeFields = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, decode(v)]));

export class Firestore {
  constructor(serviceAccount) {
    this.sa = serviceAccount;
    this.projectId = serviceAccount.project_id;
    this.root = `projects/${this.projectId}/databases/(default)/documents`;
  }

  async request(pathAndQuery, init = {}) {
    const res = await fetch(`https://firestore.googleapis.com/v1/${pathAndQuery}`, {
      ...init,
      headers: { Authorization: `Bearer ${await serviceAccountToken(this.sa)}`, 'Content-Type': 'application/json' },
    });
    if (res.status === 404 && init.allow404) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Firestore: ${json.error?.message || res.status}`);
    return json;
  }

  async get(path) {
    const doc = await this.request(`${this.root}/${path}`, { allow404: true });
    return doc ? decodeFields(doc.fields) : null;
  }

  /** Document ids and data in a collection. */
  async list(collectionPath) {
    const out = [];
    let pageToken = '';
    do {
      const page = await this.request(`${this.root}/${collectionPath}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      for (const d of page?.documents || []) out.push({ id: d.name.split('/').pop(), data: decodeFields(d.fields) });
      pageToken = page?.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  /**
   * Atomic writes: { set: path, data, merge?, mustNotExist? } or { delete: path }.
   * In data, SERVER_TIME sets the server's time and DELETE removes a field (merge only).
   */
  async commit(ops) {
    for (let i = 0; i < ops.length; i += 450) {
      const writes = ops.slice(i, i + 450).map((op) => {
        if (op.delete) return { delete: `${this.root}/${op.delete}` };
        const write = { update: { name: `${this.root}/${op.set}`, fields: encodeFields(op.data) } };
        if (op.merge) write.updateMask = { fieldPaths: Object.keys(op.data).filter((k) => op.data[k] !== SERVER_TIME) };
        const stamps = Object.keys(op.data).filter((k) => op.data[k] === SERVER_TIME);
        if (stamps.length) write.updateTransforms = stamps.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));
        if (op.mustNotExist) write.currentDocument = { exists: false };
        return write;
      });
      await this.request(`${this.root}:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
    }
  }

  /** How many documents in `parentPath`/`collectionId` match all `filters` ([field, op, value]). */
  async count(parentPath, collectionId, filters) {
    const OPS = { '==': 'EQUAL', '>': 'GREATER_THAN', '<': 'LESS_THAN' };
    const body = {
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId }],
          where: { compositeFilter: { op: 'AND', filters: filters.map(([f, op, v]) => ({ fieldFilter: { field: { fieldPath: f }, op: OPS[op], value: encode(v) } })) } },
        },
        aggregations: [{ alias: 'n', count: {} }],
      },
    };
    const rows = await this.request(`${this.root}/${parentPath}:runAggregationQuery`, { method: 'POST', body: JSON.stringify(body) });
    return Number(rows?.[0]?.result?.aggregateFields?.n?.integerValue || 0);
  }
}
