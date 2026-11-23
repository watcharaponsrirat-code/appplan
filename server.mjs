import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { openDatabase, ROLES, hashPassword, verifyPassword, publicUser } from './src/database.mjs';
import { mutate, visibleState, totals, DomainError } from './src/domain.mjs';
import { readSchoolReferenceCatalog, prepareReferenceAction } from './src/project-references.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const has=(u,...roles)=>u.roles.some(r=>roles.includes(r));
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const digest=t=>createHash('sha256').update(t).digest('hex');
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const csvCell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
const csv=rows=>'\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');

export function createApplication({dbPath=join(ROOT,'data','hongson-demo.sqlite'),seed=true}={}) {
  const store=openDatabase(dbPath,seed), db=store.db, attempts=new Map();
  function auth(req) {
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hongson_session='))?.slice(16);
    if(!token)return null;
    const session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(digest(token),Date.now());
    if(!session)return null;
    const user=store.user(session.user_id);if(!user||user.disabled)return null;
    return {user,session};
  }
  function tasks(state,user) {
    const result=[], today=day();
    const push=(id,project,title,kind,dueDate='')=>result.push({id,projectId:project?.id,title,kind,dueDate,overdue:!!dueDate&&dueDate<today,read:state.notifications.some(n=>n.userId===user.id&&(n.taskId===id||n.id===id))});
    for(const p of state.projects) {
      const mine=p.ownerId===user.id;
      if(mine&&['draft','returned'].includes(p.status))push(`project:${p.id}:${p.version}`,p,`${p.status==='returned'?'แก้ไข':'ส่ง'}โครงการ: ${p.data.title||'ร่างไม่มีชื่อ'}`,'project',state.settings.projectDeadline);
      if(p.status==='submitted'&&has(user,'planner','plan_head'))push(`review:${p.id}:${p.version}`,p,`ตรวจโครงการ: ${p.data.title}`,'review');
      if(p.status==='reviewed'&&has(user,'director'))push(`approve:${p.id}:${p.version}`,p,`อนุมัติโครงการ: ${p.data.title}`,'review');
      if(p.approvedVersionId&&mine) {
        const snap=state.versions.find(v=>v.id===p.approvedVersionId)?.data||p.data;
        if(snap.startDate&&snap.endDate>=today)push(`activity:${p.id}`,p,`จัดกิจกรรม: ${snap.title}`,'activity',snap.startDate);
        const s=state.summaries.find(x=>x.projectId===p.id);
        if(!s||['draft','returned'].includes(s.status))push(`summary:${p.id}:${s?.version||0}`,p,`ส่งสรุปผล: ${snap.title}`,'summary',state.settings.summaryDeadline);
      }
    }
    for(const r of state.requests) {
      const p=state.projects.find(p=>p.id===r.projectId);
      if(r.ownerId===user.id&&['draft','returned'].includes(r.status))push(`request:${r.id}:${r.version}`,p,'จัดทำ/แก้ไขคำขอ: '+(p?.data.title||''),'request');
      if(r.status==='submitted'&&has(user,'planner','plan_head'))push(`request-review:${r.id}:${r.version}`,p,'ตรวจคำขอ: '+(p?.data.title||''),'request');
      if(r.status==='reviewed'&&has(user,'director'))push(`request-approve:${r.id}:${r.version}`,p,'อนุมัติคำขอ: '+(p?.data.title||''),'request');
      if(r.status==='approved'&&['spend','purchase'].includes(r.type)&&!state.commitments.some(c=>c.requestId===r.id||c.requestIds?.includes(r.id))&&has(user,'procurement'))push(`procurement:${r.id}`,p,'ยืนยันพัสดุ: '+(p?.data.title||''),'procurement');
    }
    for(const c of state.commitments)if(c.amount>c.paid&&has(user,'finance'))push(`payment:${c.id}:${c.version}`,state.projects.find(p=>p.id===c.projectId),'บันทึกจ่าย: '+(state.projects.find(p=>p.id===c.projectId)?.data.title||''),'finance');
    for(const s of state.summaries)if(s.status==='submitted'&&has(user,'planner','plan_head'))push(`summary-review:${s.id}:${s.version}`,state.projects.find(p=>p.id===s.projectId),'ตรวจสรุปผล: '+(s.data?.outcome||''),'summary');
    return result;
  }
  function view(user,state=store.load()) {
    const safe=visibleState(state,user);
    safe.schoolReferenceCatalog=readSchoolReferenceCatalog();
    safe.budgets=safe.projects.map(p=>({projectId:p.id,...totals(state,p.id)}));
    const ids=new Set(safe.projects.map(x=>x.id));
    safe.attachments=db.prepare('SELECT id,project_id AS projectId,name,type,size,created_at AS createdAt FROM attachments').all().filter(a=>ids.has(a.projectId));
    return safe;
  }
  function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  async function body(req) {
    if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'กรุณาส่งข้อมูลแบบ JSON');
    let size=0,chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)fail(413,'ข้อมูลใหญ่เกิน 8 MB');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'ข้อมูล JSON ไม่ถูกต้อง');}
  }
  function projectAccess(state,user,id) {if(!view(user,state).projects.some(p=>p.id===id))fail(403,'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');}
  function adminSave(user,input) {
    if(!has(user,'admin'))fail(403,'เฉพาะผู้ดูแลระบบ');
    let existing=input.id?store.user(input.id):null;
    if(input.id&&!existing)fail(404,'ไม่พบบัญชี');
    if(existing&&existing.version!==input.version)fail(409,'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาโหลดใหม่');
    if(!/^[a-z0-9_.-]{3,40}$/.test(input.username||''))fail(400,'ชื่อบัญชีใช้ a-z ตัวเลข _ . - ความยาว 3–40 ตัว');
    if(!String(input.name||'').trim())fail(400,'กรุณาระบุชื่อ');
    if(!Array.isArray(input.roles)||!input.roles.length||input.roles.some(r=>!ROLES.includes(r)))fail(400,'บทบาทไม่ถูกต้อง');
    if((!existing||input.password)&&String(input.password||'').length<8)fail(400,'รหัสผ่านต้องมีอย่างน้อย 8 ตัว');
    if(existing?.roles.includes('admin')&&(!input.roles.includes('admin')||input.disabled)&&store.users().filter(u=>u.id!==existing.id&&!u.disabled&&u.roles.includes('admin')).length===0)fail(400,'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อยหนึ่งคน');
    const row={id:existing?.id||randomUUID(),username:input.username,name:String(input.name).trim().slice(0,150),roles:[...new Set(input.roles)],disabled:!!input.disabled,version:(existing?.version||0)+1,passwordHash:input.password?hashPassword(input.password):existing.passwordHash};
    return store.transaction(state=>{
      try{db.prepare('INSERT INTO users(id,username,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,body=excluded.body').run(row.id,row.username,JSON.stringify(row));}catch(e){if(e.message.includes('UNIQUE'))fail(409,'ชื่อบัญชีนี้ถูกใช้แล้ว');throw e;}
      if(existing)db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);
      state.audit.push({id:randomUUID(),action:'user.save',actorId:user.id,actorName:user.name,entityId:row.id,at:new Date().toISOString(),detail:{username:row.username,roles:row.roles,disabled:row.disabled}});
      return publicUser(row);
    });
  }
  function exportRows(state,type,params) {
    const filtered=state.projects.filter(p=>p.approvedVersionId).map(p=>({p,data:state.versions.find(v=>v.id===p.approvedVersionId)?.data||p.data})).filter(({p,data})=>['fiscalYear','academicYear','term','group'].every(k=>!params.get(k)||String(data[k])===params.get(k))&&(!params.get('projectId')||p.id===params.get('projectId')));
    const source=params.get('source');
    if(type==='summaries')return [['รหัสกิจกรรม','กิจกรรม','สถานะสรุป','ความสำเร็จ (%)','ความพึงพอใจ (%)','จ่ายจริง (บาท)','ปัญหา'],...filtered.map(({p,data})=>{const s=state.summaries.find(s=>s.projectId===p.id);return [p.id,data.title,s?.status||'ยังไม่ส่ง',s?.data.success??'',s?.data.scores?.length===8?s.data.scores.reduce((a,b)=>a+Number(b),0)/32*100:'',totals(state,p.id).paid/100,(s?.data.problems||[]).map(x=>`${x.category}: ${x.status} ${x.cause||''}`).join('; ')];})];
    if(type==='quarter')return [['รหัสกิจกรรม','กิจกรรม','ปีงบประมาณ','ภาคเรียน','เดือนใช้เงิน (ยังไม่กำหนดไตรมาสโรงเรียน)','แหล่งเงิน','ยอด (บาท)'],...filtered.flatMap(({p,data})=>(data.resources||[]).filter(r=>!source||r.source===source).flatMap(r=>(r.spending||[]).map(m=>[p.id,data.title,data.fiscalYear,data.term,m.month,r.source,m.amount/100])))];
    if(['strategy','standards','plan'].includes(type))return [['รหัสกิจกรรม','กิจกรรม','ปีงบประมาณ','ปีการศึกษา','ภาคเรียน','กลุ่มงาน','โครงการเชิงกลยุทธ์','กลยุทธ์','มาตรฐาน (รวมในช่องเดียวไม่รวมงบซ้ำ)','งบอนุมัติ (บาท)'],...filtered.map(({p,data})=>[p.id,data.title,data.fiscalYear,data.academicYear,data.term,data.group,data.strategicProjectName||data.strategicProjectId,data.strategy,(data.standards||[]).join('; '),(source?totals(state,p.id).bySource[source]?.approved||0:totals(state,p.id).approved)/100])];
    return [['รหัสกิจกรรม','กิจกรรม','ปีงบประมาณ','ภาคเรียน','กลุ่มงาน','แหล่งเงิน','อนุมัติ (บาท)','กันไว้ค้างจ่าย (บาท)','จ่ายจริง (บาท)','คงเหลือ (บาท)'],...filtered.flatMap(({p,data})=>Object.entries(totals(state,p.id).bySource).filter(([s])=>!source||s===source).map(([s,t])=>[p.id,data.title,data.fiscalYear,data.term,data.group,s,t.approved/100,t.reserved/100,t.paid/100,t.available/100]))];
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host=req.headers.host||'';
      if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))fail(403,'อนุญาตเฉพาะการเปิดผ่าน localhost');
      const url=new URL(req.url,`http://${host}`);
      if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,app:'hongson-plan',mode:'local-demo',database:'sqlite',schemaVersion:1});
      if(req.method==='POST') {
        if(req.headers.origin&&req.headers.origin!==`http://${host}`)fail(403,'แหล่งที่มาของคำขอไม่ถูกต้อง');
        if(req.headers['sec-fetch-site']==='cross-site')fail(403,'ไม่รับคำขอข้ามเว็บไซต์');
      }
      if(url.pathname==='/api/login'&&req.method==='POST') {
        const data=await body(req),username=String(data.username||'').toLowerCase();
        const key=`${req.socket.remoteAddress}:${username}`,entry=attempts.get(key);
        if(entry&&entry.until>Date.now()&&entry.count>=12)fail(429,'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอหนึ่งนาที');
        const user=store.users().find(u=>u.username.toLowerCase()===username);
        if(!user||user.disabled||!verifyPassword(String(data.password||''),user.passwordHash)) {attempts.set(key,{count:entry&&entry.until>Date.now()?entry.count+1:1,until:Date.now()+60000});fail(401,'ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง');}
        attempts.delete(key);const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),user.id,csrf,Date.now()+8*3600*1000);
        res.setHeader('Set-Cookie',`hongson_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
        return json(res,200,{user:publicUser(user),csrf});
      }
      if(url.pathname.startsWith('/api/')) {
        const ctx=auth(req);if(!ctx)fail(401,'กรุณาเข้าสู่ระบบ');const {user,session}=ctx;
        if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)fail(403,'โทเคนความปลอดภัยไม่ถูกต้อง กรุณาโหลดหน้าใหม่');
        if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(res,200,{user:publicUser(user),users:store.users().map(u=>has(user,'admin')?publicUser(u):{id:u.id,name:u.name,username:u.username,roles:u.roles}),state:view(user),csrf:session.csrf,integrations:{sheets:false,phone:false}});
        if(req.method==='POST'&&url.pathname==='/api/logout'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);res.setHeader('Set-Cookie','hongson_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
        if(req.method==='POST'&&url.pathname==='/api/action') {
          const data=await body(req);if(!data||typeof data.action!=='string')fail(400,'ไม่ระบุการทำงาน');
          const {state,result}=data.action==='user.save'?adminSave(user,data):store.transaction(s=>{
            prepareReferenceAction(s,data);
            const evidence=data.evidence||data.data?.evidence||[];
            for(const id of evidence){const file=db.prepare('SELECT project_id FROM attachments WHERE id=?').get(id);if(!file)fail(400,'ไม่พบไฟล์หลักฐาน');projectAccess(s,user,file.project_id);const target=data.projectId||s.requests.find(x=>x.id===data.id)?.projectId||s.commitments.find(x=>x.id===(data.commitmentId||data.id))?.projectId||s.summaries.find(x=>x.id===data.id)?.projectId;if(target&&target!==file.project_id)fail(400,'ไฟล์หลักฐานต้องเป็นของกิจกรรมเดียวกัน');}
            return mutate(s,user,data);
          });
          return json(res,200,{result,state:view(user,state)});
        }
        if(req.method==='POST'&&url.pathname==='/api/upload') {
          const data=await body(req);projectAccess(store.load(),user,data.projectId);
          if(!String(data.name||'').trim()||!data.data||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.data))fail(400,'ไฟล์ไม่ถูกต้อง');
          const bytes=Buffer.from(data.data,'base64');if(bytes.length===0||bytes.length>5*1024*1024)fail(400,'ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 5 MB');
          const id=randomUUID(),name=String(data.name).replace(/[\\/\r\n\x00]/g,'_').slice(0,180);
          db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').run(id,data.projectId,user.id,name,String(data.type||'application/octet-stream').slice(0,100),bytes.length,bytes,new Date().toISOString());
          return json(res,201,{id,name});
        }
        if(req.method==='GET'&&url.pathname.startsWith('/api/files/')) {
          const f=db.prepare('SELECT * FROM attachments WHERE id=?').get(url.pathname.slice(11));if(!f)fail(404,'ไม่พบไฟล์');projectAccess(store.load(),user,f.project_id);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'no-store'});return res.end(Buffer.from(f.content));
        }
        if(req.method==='GET'&&url.pathname==='/api/export') {
          const type=url.searchParams.get('type')||'budget';if(!['budget','strategy','quarter','standards','summaries','plan'].includes(type))fail(400,'ประเภทรายงานไม่ถูกต้อง');
          res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="hongson-${type}.csv"`,'Cache-Control':'no-store'});return res.end(csv(exportRows(view(user),type,url.searchParams)));
        }
        fail(404,'ไม่พบ API ที่ร้องขอ');
      }
      if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'วิธีเรียกไม่รองรับ');
      const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/project-template.js':'project-template.js','/reference-picker.js':'reference-picker.js','/style.css':'style.css'};
      const filename=allowed[url.pathname];if(!filename)fail(404,'ไม่พบหน้า');
      const file=join(ROOT,'public',filename);if(!existsSync(file))fail(503,'หน้าจออยู่ระหว่างการติดตั้ง');
      const data=readFileSync(file);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่',...(process.env.NODE_ENV==='test'?{detail:error.message}:{})});else res.end();if(!error.status)console.error(error);}
  });
  server.requestTimeout=30000;
  return {server,db,store,close:async()=>{if(server.listening)await new Promise((ok,err)=>server.close(e=>e?err(e):ok()));store.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=createApplication({dbPath:process.env.HONGSON_DB||join(ROOT,'data','hongson-demo.sqlite')});
  const port=Number(process.env.PORT||4310);
  app.server.listen(port,'127.0.0.1',()=>console.log(`Hongson Plan: http://127.0.0.1:${port}\nSQLite: ${process.env.HONGSON_DB||join(ROOT,'data','hongson-demo.sqlite')}\nLocal demo only; Sheets and phone are not connected.`));
  app.server.on('error',e=>{console.error(e.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
