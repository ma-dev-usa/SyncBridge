import { DatabaseSync } from 'node:sqlite';
import { mapEvent, failureDecision, simulateDelivery } from './core.mjs';

export class Store {
  constructor(path = ':memory:', clock = Date.now) {
    this.db = new DatabaseSync(path);
    this.clock = clock;
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL, data TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','retry','delivered','dead')), attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_error TEXT);" +
      "CREATE INDEX IF NOT EXISTS queue_due ON events(status,next_at,created_at);" +
      "CREATE TABLE IF NOT EXISTS attempts (seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), attempt INTEGER NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL, occurred_at INTEGER NOT NULL);" +
      "CREATE INDEX IF NOT EXISTS attempt_event ON attempts(event_id,seq);" +
      "CREATE TABLE IF NOT EXISTS deliveries (event_id TEXT PRIMARY KEY REFERENCES events(id), target TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, delivered_at INTEGER NOT NULL);"
    );
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  ingest(input, mode = 'normal') {
    if (!['normal','transient','permanent'].includes(mode)) throw Error('Invalid simulation mode');
    const event = mapEvent(input), data = JSON.stringify(event.data), now = this.clock();
    return this.tx(() => {
      const existing = this.get(event.id);
      if (existing) {
        if (existing.type !== event.type || existing.source !== event.source || existing.data !== data || existing.mode !== mode)
          return {conflict:true,event:existing};
        return {duplicate:true,event:existing};
      }
      this.db.prepare("INSERT INTO events(id,type,source,target,data,mode,status,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'queued',?,?,?)")
        .run(event.id,event.type,event.source,event.target,data,mode,now,now,now);
      return {duplicate:false,event:this.get(event.id)};
    });
  }

  get(id) { return this.db.prepare('SELECT * FROM events WHERE id=?').get(id); }
  history(id) { return this.db.prepare('SELECT * FROM attempts WHERE event_id=? ORDER BY seq').all(id); }
  list(limit=100) {
    return this.db.prepare('SELECT id,type,source,target,status,attempts,next_at,created_at,updated_at,last_error FROM events ORDER BY created_at DESC,id DESC LIMIT ?').all(limit);
  }
  stats() {
    const counts = {queued:0,retry:0,delivered:0,dead:0};
    for (const row of this.db.prepare('SELECT status,count(*) AS n FROM events GROUP BY status').all()) counts[row.status]=row.n;
    return counts;
  }
  deliveryCount() { return this.db.prepare('SELECT count(*) AS n FROM deliveries').get().n; }

  tick() {
    const now = this.clock();
    return this.tx(() => {
      const row = this.db.prepare("SELECT * FROM events WHERE status IN ('queued','retry') AND next_at<=? ORDER BY next_at,created_at,id LIMIT 1").get(now);
      if (!row) return null;
      const attempt = row.attempts+1;
      const result = simulateDelivery(row,attempt,row.mode);
      const decision = result.ok ? {status:'delivered',nextAt:now} : failureDecision(attempt,result.permanent,now);
      if (result.ok) this.db.prepare('INSERT INTO deliveries(event_id,target,type,data,delivered_at) VALUES(?,?,?,?,?)').run(row.id,row.target,row.type,row.data,now);
      this.db.prepare('UPDATE events SET status=?,attempts=?,next_at=?,updated_at=?,last_error=? WHERE id=?').run(decision.status,attempt,decision.nextAt,now,result.ok?null:result.message,row.id);
      this.db.prepare('INSERT INTO attempts(event_id,attempt,outcome,detail,occurred_at) VALUES(?,?,?,?,?)').run(row.id,attempt,decision.status,result.message,now);
      return {id:row.id,attempt,status:decision.status};
    });
  }

  replay(id) {
    return this.tx(() => {
      const row=this.get(id), now=this.clock();
      if (!row) return null;
      if (row.status!=='dead') return {conflict:true,event:row};
      this.db.prepare("UPDATE events SET status='queued',attempts=0,next_at=?,updated_at=?,last_error=NULL WHERE id=?").run(now,now,id);
      this.db.prepare("INSERT INTO attempts(event_id,attempt,outcome,detail,occurred_at) VALUES(?,0,'replayed','Operator requested replay',?)").run(id,now);
      return {event:this.get(id)};
    });
  }
  close() { this.db.close(); }
}
