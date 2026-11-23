import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ROLES = ['teacher','planner','plan_head','director','procurement','finance','admin'];
export const TABLES = ['projects','versions','requests','commitments','payments','summaries','audit','outbox','allocations','references','notifications'];
const CHILDREN = new Set(['versions','requests','commitments','summaries']);
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function verifyPassword(password, hash) {
  try { const [salt, encoded] = hash.split(':'); return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(encoded,'hex')); } catch {return false;}
}
export function publicUser(u) { const {passwordHash,...safe} = u; return safe; }
export function openDatabase(path, seed=true) {
  if(path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, body TEXT NOT NULL CHECK(json_valid(body)));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,content BLOB NOT NULL,created_at TEXT NOT NULL);`);
  for(const table of TABLES) db.exec(`CREATE TABLE IF NOT EXISTS "${table}"(id TEXT PRIMARY KEY, ${CHILDREN.has(table)?`project_id TEXT ${table === 'requests' ? '' : 'NOT NULL '}REFERENCES projects(id),`:''}body TEXT NOT NULL CHECK(json_valid(body)));`);
  // Existing installations must retain their request bodies and history while
  // allowing a teacher to prepare a request before a project has been linked.
  if (db.prepare('PRAGMA table_info(requests)').all().find(column => column.name === 'project_id')?.notnull) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE requests_with_optional_project(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),body TEXT NOT NULL CHECK(json_valid(body)));
      INSERT INTO requests_with_optional_project(id,project_id,body) SELECT id,project_id,body FROM requests;
      DROP TABLE requests;
      ALTER TABLE requests_with_optional_project RENAME TO requests;
      COMMIT;`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS summary_project ON summaries(project_id);
    CREATE INDEX IF NOT EXISTS version_project ON versions(project_id);
    CREATE INDEX IF NOT EXISTS request_project ON requests(project_id);
    CREATE INDEX IF NOT EXISTS commitment_project ON commitments(project_id);`);
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('schemaVersion','1');
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('settings',JSON.stringify({projectDeadline:'',summaryDeadline:'',reminderDays:7}));
  if(seed && !db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const names={teacher:'ครูทดลอง',teacher2:'ครูทดลองคนที่ 2',planner:'เจ้าหน้าที่งานแผนทดลอง',plan_head:'หัวหน้างานแผนทดลอง',director:'ผู้อำนวยการทดลอง',procurement:'พัสดุทดลอง',finance:'การเงินทดลอง',admin:'ผู้ดูแลระบบทดลอง',multi:'ครูและงานแผนทดลอง'};
    const put=db.prepare('INSERT INTO users(id,username,body) VALUES(?,?,?)');
    for(const [username,name] of Object.entries(names)) {
      const user={id:`u-${username}`,username,name,roles:username==='multi'?['teacher','planner']:[username==='teacher2'?'teacher':username],passwordHash:hashPassword('Demo@2569'),version:1,disabled:false};
      put.run(user.id,username,JSON.stringify(user));
    }
    const refs=[
      {id:'ref-demo-project',kind:'strategic_project',name:'โครงการเชิงกลยุทธ์ทดลอง A',code:'DEMO-A'},
      {id:'ref-demo-group',kind:'group',name:'กลุ่มงานทดลอง',code:'DEMO-G'},
      {id:'ref-demo-source',kind:'source',name:'แหล่งเงินทดลอง A',code:'DEMO-F'},
      {id:'ref-demo-price',kind:'price',name:'กระดาษทดลอง',code:'DEMO-P',data:{spec:'ตัวอย่างสำหรับทดลองระบบ',brand:'ยี่ห้อทดลอง',unit:'รีม',unitPrice:12000,source:'แหล่งเงินทดลอง A',priceVersion:'DEMO-1',priceDate:'2026-11-09'}}
    ];
    for(const ref of refs) db.prepare('INSERT INTO "references"(id,body) VALUES(?,?)').run(ref.id,JSON.stringify({...ref,version:1,isDemo:true,origin:'ข้อมูลทดลอง ไม่ใช่ข้อมูลทางการของโรงเรียน',edition:'DEMO-1'}));
  }
  function load() {
    const state={settings:JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('settings').value)};
    for(const table of TABLES) state[table]=db.prepare(`SELECT body FROM "${table}" ORDER BY rowid`).all().map(row=>JSON.parse(row.body));
    return state;
  }
  function persist(state) {
    for(const table of TABLES) {
      const child=CHILDREN.has(table);
      const stmt=db.prepare(`INSERT INTO "${table}"(id,${child?'project_id,':''}body) VALUES(?,${child?'?,':''}?) ON CONFLICT(id) DO UPDATE SET body=excluded.body${child?',project_id=excluded.project_id':''}`);
      for(const item of state[table]||[]) child?stmt.run(item.id,item.projectId,JSON.stringify(item)):stmt.run(item.id,JSON.stringify(item));
    }
    db.prepare('UPDATE meta SET value=? WHERE key=?').run(JSON.stringify(state.settings),'settings');
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const state=load(); const result=fn(state); persist(state); db.exec('COMMIT'); return {state,result}; }
    catch(error) { db.exec('ROLLBACK'); throw error; }
  }
  return {db,load,persist,transaction,users:()=>db.prepare('SELECT body FROM users ORDER BY username').all().map(x=>JSON.parse(x.body)),user:id=>{const row=db.prepare('SELECT body FROM users WHERE id=?').get(id);return row?JSON.parse(row.body):null;},close:()=>db.close()};
}
