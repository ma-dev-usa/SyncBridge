import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
const fixtures=JSON.parse(readFileSync(new URL('../fixtures/events.json',import.meta.url),'utf8'));
function setup(t){let now=1000;const store=new Store(':memory:',()=>now);t.after(()=>store.close());return {store,advance:n=>now+=n};}
test('duplicate accepted once; conflicting ID rejected',t=>{
  const {store}=setup(t), event=fixtures[0];
  assert.equal(store.ingest(event).duplicate,false);
  assert.equal(store.ingest(event).duplicate,true);
  assert.equal(store.ingest({...event,payload:{...event.payload,name:'Other'}}).conflict,true);
  assert.equal(store.tick().status,'delivered');
  assert.equal(store.tick(),null);
  assert.equal(store.deliveryCount(),1);
});
test('transient failure respects retry due time',t=>{
  const {store,advance}=setup(t);store.ingest(fixtures[1],'transient');
  assert.equal(store.tick().status,'retry');assert.equal(store.tick(),null);
  advance(1000);assert.equal(store.tick().status,'retry');assert.equal(store.tick(),null);
  advance(2000);assert.equal(store.tick().status,'delivered');
  assert.equal(store.history(fixtures[1].id).length,3);assert.equal(store.deliveryCount(),1);
});
test('permanent failure and replay retain history',t=>{
  const {store}=setup(t);store.ingest(fixtures[3],'permanent');
  assert.equal(store.tick().status,'dead');assert.equal(store.deliveryCount(),0);
  assert.equal(store.replay(fixtures[3].id).event.status,'queued');
  assert.equal(store.tick().status,'dead');
  assert.deepEqual(store.history(fixtures[3].id).map(x=>x.outcome),['dead','replayed','dead']);
});
test('delivered events cannot be replayed',t=>{
  const {store}=setup(t);store.ingest(fixtures[2]);store.tick();
  assert.equal(store.replay(fixtures[2].id).conflict,true);assert.equal(store.replay('missing'),null);
});
test('queued work survives restart',t=>{
  const dir=mkdtempSync(join(tmpdir(),'syncbridge-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'events.sqlite');let store=new Store(path,()=>1000);
  store.ingest(fixtures[0]);store.close();store=new Store(path,()=>1000);
  try{assert.equal(store.tick().status,'delivered');assert.equal(store.deliveryCount(),1);}finally{store.close();}
});
test('10,000 events and repeated submissions produce one receipt per ID',t=>{
  const {store}=setup(t);
  for(let i=0;i<10000;i++){const event={...fixtures[2],id:'load-'+i};store.ingest(event);assert.equal(store.ingest(event).duplicate,true);}
  let count=0;while(store.tick())count++;
  assert.equal(count,10000);assert.equal(store.deliveryCount(),10000);assert.equal(store.stats().delivered,10000);
});
