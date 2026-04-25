const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

class AuditLog {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, '');
    }
  }

  async list() {
    await this.init();
    const text = await fs.readFile(this.filePath, 'utf8');
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async append(input) {
    await this.init();
    const events = await this.list();
    const prevHash = events.length > 0 ? events[events.length - 1].hash : 'GENESIS';
    const event = {
      id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      actorId: input.actorId,
      actorRole: input.actorRole,
      department: input.department,
      action: input.action,
      subject: input.subject,
      resource: input.resource || null,
      metadata: input.metadata || {},
      prevHash,
    };
    event.hash = sha256(stableStringify(event));
    await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  async verify() {
    const events = await this.list();
    let prevHash = 'GENESIS';
    for (const event of events) {
      if (event.prevHash !== prevHash) {
        return {
          ok: false,
          reason: 'Previous hash mismatch',
          eventId: event.id,
        };
      }
      const { hash, ...withoutHash } = event;
      const expected = sha256(stableStringify(withoutHash));
      if (hash !== expected) {
        return {
          ok: false,
          reason: 'Event hash mismatch',
          eventId: event.id,
        };
      }
      prevHash = hash;
    }
    return {
      ok: true,
      count: events.length,
      headHash: events.length > 0 ? events[events.length - 1].hash : 'GENESIS',
    };
  }
}

module.exports = {
  AuditLog,
  stableStringify,
  sha256,
};
