import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.mjs';

const key = process.env.SYNCBRIDGE_API_KEY;
if (!key || key.length < 24) throw Error('Set SYNCBRIDGE_API_KEY to at least 24 characters');
const path = process.env.SYNCBRIDGE_DB || 'data/syncbridge.sqlite';
mkdirSync(dirname(path),{recursive:true});
const store = new Store(path);
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
const simulation = process.env.ENABLE_SIMULATION === '1';
const dashboard = readFileSync(new URL('../dashboard.html',import.meta.url));
const demo = readFileSync(new URL('../demo.html',import.meta.url));

function authorized(req) {
  const actual=Buffer.from(req.headers.authorization||'');
  const expected=Buffer.from('Bearer '+key);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function html(res,data) {
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(data);
}
async function body(req) {
  if (!(req.headers['content-type']||'').toLowerCase().startsWith('application/json')) throw Error('Expected application/json');
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>65536) throw Error('Request exceeds 64 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const server=http.createServer(async(req,res)=>{
  let p='';
  try {
    try { p=decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
    catch { return json(res,400,{error:'Malformed URL'}); }
    const m=req.method;
    if(m==='GET'&&p==='/healthz')return json(res,200,{status:'ok'});
    if(m==='GET'&&p==='/readyz'){store.stats();return json(res,200,{status:'ready'});}
    if(m==='GET'&&p==='/')return html(res,dashboard);
    if(m==='GET'&&p==='/demo')return html(res,demo);
    if(!authorized(req))return json(res,401,{error:'Unauthorized'});
    if(m==='GET'&&p==='/api/v1/events')return json(res,200,{events:store.list(),counts:store.stats(),deliveries:store.deliveryCount()});
    if(m==='POST'&&p==='/api/v1/events'){
      let input;try{input=await body(req);}catch(e){return json(res,400,{error:e.message});}
      if(!input||typeof input!=='object'||Array.isArray(input))return json(res,400,{error:'Expected an event object'});
      const mode=input.mode??'normal';
      if(mode!=='normal'&&!simulation)return json(res,400,{error:'Fault injection disabled'});
      let r;try{r=store.ingest(input,mode);}catch(e){if(e.code?.startsWith('ERR_SQLITE'))throw e;return json(res,422,{error:e.message});}
      return json(res,r.conflict?409:r.duplicate?200:202,r);
    }
    const match=p.match(/^\/api\/v1\/events\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,79})(\/replay)?$/);
    if(match){
      const id=match[1];
      if(m==='GET'&&!match[2]){const event=store.get(id);return json(res,event?200:404,event?{event,history:store.history(id)}:{error:'Not found'});}
      if(m==='POST'&&match[2]){const result=store.replay(id);return json(res,!result?404:result.conflict?409:202,result||{error:'Not found'});}
    }
    return json(res,404,{error:'Not found'});
  }catch(e){console.error(JSON.stringify({level:'error',message:'request failed',path:p}));if(!res.headersSent)json(res,500,{error:'Internal server error'});else res.end();}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=50;
const timer=setInterval(()=>{
  try {for(let i=0;i<50;i++){const r=store.tick();if(!r)break;console.log(JSON.stringify({level:'info',event:'delivery_attempt',...r}));}}
  catch(e){console.error(JSON.stringify({level:'error',message:'worker failed'}));}
},250);
server.listen(port,host,()=>console.log(JSON.stringify({level:'info',event:'listening',host,port:server.address().port,simulation})));
function shutdown(){clearInterval(timer);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
