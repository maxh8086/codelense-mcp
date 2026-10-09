import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Small JSON-file store for codelense's own metadata (project roots, annotations, ADRs, settings, usage, audit log).
// It never touches the user's repository or the databases an ERD is read from.
export class Store {
  constructor(dir) {
    this.dir = path.resolve(dir);
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'store.json');
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    this.key = this._key();
  }

  _key() {
    const env = process.env.CODELENSE_SECRET;
    if (env) return crypto.createHash('sha256').update(env).digest();
    const f = path.join(this.dir, '.secret');
    try { return Buffer.from(fs.readFileSync(f, 'utf8'), 'hex'); } catch { /* create */ }
    const k = crypto.randomBytes(32);
    fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
    return k;
  }

  get(k, d) { return this.data[k] ?? d; }
  set(k, v) { this.data[k] = v; this._save(); return v; }
  update(k, fn, d = {}) { return this.set(k, fn(structuredClone(this.data[k] ?? d))); }
  _save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }

  seal(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }

  open(sealed) {
    if (!sealed) return '';
    const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  }

  audit(event) {
    fs.appendFileSync(path.join(this.dir, 'audit.log'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }
}
