import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

test('HTTP ingestion, authorization, duplicate handling and replay', {timeout:20000}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'syncbridge-http-'));
  const key='test-only-key-not-for-deployment';
  const child=spawn(process.execPath,['src/server.mjs'],{
    env:{...process.env,PORT:'0',HOST:'127.0.0.1',SYNCBRIDGE_DB:join(dir,'db.sqlite'),SYNCBRIDGE_API_KEY:key,ENABLE_SIMULATION:'1'},
    stdio:['ignore','pipe','pipe']
  });
  t.after(async()=>{
    if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}
    rmSync(dir,{recursive:true,force:true});
  });
  let buffer='', stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Server startup timed out: '+stderr)),5000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited: '+code+' '+stderr));});
    child.stdout.on('data',chunk=>{
      buffer+=chunk;
      let end;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        try{const event=JSON.parse(line);if(event.event==='listening'){clearTimeout(timer);resolve(event.port);}}catch{}
      }
    });
  });
  const base='http://127.0.0.1:'+port;
  const call=(path,method='GET',data,auth=true)=>fetch(base+path,{
    method,headers:{...(auth?{Authorization:'Bearer '+key}:{}),...(data?{'Content-Type':'application/json'}:{})},
    body:data?JSON.stringify(data):undefined
  });
  assert.equal((await call('/readyz','GET',undefined,false)).status,200);
  assert.equal((await call('/api/v1/events','GET',undefined,false)).status,401);
  const event={id:'http:1',type:'inventory.updated',source:'erp',payload:{sku:'X',quantity:5}};
  assert.equal((await call('/api/v1/events','POST',event)).status,202);
  assert.equal((await call('/api/v1/events','POST',event)).status,200);
  assert.equal((await call('/api/v1/events','POST',{...event,payload:{sku:'X',quantity:6}})).status,409);
  assert.equal((await call('/api/v1/events','POST',{...event,id:'..'})).status,422);
  assert.equal((await call('/api/v1/events','POST',{...event,id:'dead-1',mode:'permanent'})).status,202);
  async function waitFor(id,status){
    for(let i=0;i<80;i++){
      const response=await call('/api/v1/events/'+encodeURIComponent(id));
      assert.equal(response.status,200);
      const result=await response.json();
      if(result.event.status===status)return result;
      await delay(50);
    }
    assert.fail('Event did not reach '+status);
  }
  await waitFor('http:1','delivered');
  await waitFor('dead-1','dead');
  assert.equal((await call('/api/v1/events/dead-1/replay','POST')).status,202);
  const result=await waitFor('dead-1','dead');
  assert.deepEqual(result.history.map(x=>x.outcome),['dead','replayed','dead']);
  const ledger=await (await call('/api/v1/events')).json();
  assert.equal(ledger.deliveries,1);
});
