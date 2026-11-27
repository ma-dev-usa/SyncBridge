import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('demo embeds current core and fixtures',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const core=read('src/core.mjs').replace(/\nexport\s*\{mapEvent,failureDecision,simulateDelivery\};\s*$/,'').trim();
  const demo=read('demo.html');
  assert.ok(demo.includes(core));
  assert.ok(demo.includes('const fixtures='+JSON.stringify(JSON.parse(read('fixtures/events.json')))));
});
