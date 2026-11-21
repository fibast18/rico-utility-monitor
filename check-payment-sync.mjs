// Synthetic tests for independently paid utility bills and linked snapshot publication.
// Does not access user Firebase, local devices, or financial records.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync('index.html','utf8');
const syncCode=readFileSync('firebase-sync.js','utf8');
const bridgeCode=readFileSync('utility-finance-bridge.js','utf8');
const {buildFinancePaidSnapshot}=await import('data:text/javascript,'+encodeURIComponent(bridgeCode));

const marker=html.indexOf('function repairDuplicateRecordIds(records){');
const end=html.indexOf('\nfunction save()',marker);
assert(marker>=0&&end>marker,'Startup duplicate-ID repair must exist');
const ctx1={Set,console};
new Script(html.slice(marker,end)+'\nglobalThis.repair=repairDuplicateRecordIds;')
 .runInContext(createContext(ctx1));
const basic={
 records:[
  {id:'old-id',type:'electricity',date:'2026-11-02',amount:1600,status:'unpaid',updatedAt:'2026-11-03'},
  {id:'old-id',type:'water',date:'2026-11-04',amount:250,status:'unpaid',updatedAt:'2026-11-04'},
  {id:'fuel-id',type:'car',date:'2026-11-07',amount:850,status:'paid',updatedAt:'2026-11-07'}
 ],
 dailyReadings:[],camellaDues:{entries:[],beginningBalance:0},
 cogeaCbuOverrides:{}
};
const duplicateState=structuredClone(basic);
assert.equal(ctx1.repair(duplicateState.records),1);
assert.equal(new Set(duplicateState.records.map(x=>x.id)).size,3);
assert.equal(ctx1.repair(duplicateState.records),0,'Re-running migration must not change IDs');
assert.equal(duplicateState.records[0].status,'unpaid');
assert.equal(duplicateState.records[1].status,'unpaid');
assert.equal(duplicateState.records[1].amount,250,'Migration only changes duplicate ID');
duplicateState.records[1].status='paid';
duplicateState.records[1].updatedAt='2026-11-21T12:00:00Z';
assert.equal(duplicateState.records[0].status,'unpaid','Water payment must never change electricity');

const start=syncCode.indexOf('const same = ');
const finish=syncCode.indexOf('export function createSync(',start);
assert(start>=0&&finish>start);
const ctx2={JSON,Map,Set,TextEncoder};
new Script(syncCode.slice(start,finish)+'\nglobalThis.merged=merge;')
 .runInContext(createContext(ctx2));
const merged=ctx2.merged(basic,duplicateState,basic);
assert.equal(merged.records.length,3,'Duplicate legacy ID must never silently discard a bill');
assert.equal(new Set(merged.records.map(x=>x.id)).size,3);
assert.equal(merged.records.find(x=>x.type==='water').status,'paid');
assert.equal(merged.records.find(x=>x.type==='electricity').status,'unpaid');
let paid=buildFinancePaidSnapshot(merged);
assert.deepEqual(paid.entries.map(x=>x.type).sort(),['car','water'],'Only paid rows published to Finances');
assert.equal(paid.entries.reduce((a,b)=>a+b.amount,0),1100);

const next=structuredClone(merged);
next.records.find(x=>x.type==='electricity').status='paid';
next.records.find(x=>x.type==='electricity').updatedAt='2026-11-21T12:01:00Z';
paid=buildFinancePaidSnapshot(next);
assert.deepEqual(paid.entries.map(x=>x.type).sort(),['car','electricity','water']);
assert.equal(paid.entries.reduce((a,b)=>a+b.amount,0),2700);
const after=structuredClone(next);
after.records.find(x=>x.type==='water').status='unpaid';
after.records.find(x=>x.type==='water').updatedAt='2026-11-21T12:02:00Z';
paid=buildFinancePaidSnapshot(after);
assert.deepEqual(paid.entries.map(x=>x.type).sort(),['car','electricity']);
assert.equal(paid.entries.reduce((a,b)=>a+b.amount,0),2450);
assert.equal(after.records.find(x=>x.type==='electricity').status,'paid',
 'Unpaying water cannot change electricity status');

assert.match(html,/case 'toggle-paid':\{[\s\S]*?const matches=db\.records\.filter\(x=>x\.id===key\)/);
assert.match(html,/if\(matches\.length!==1\)/,'Nonunique IDs must block unsafe toggles');
assert.match(syncCode,/db\.getDocFromServer\(ref\)/,'Publisher must confirm Firestore server snapshot');
assert.match(syncCode,/Paid bills NOT linked to Rico Finances AI/,
 'Publishing errors must be explicit');
console.log('PASS: separate bill status, legacy duplicate ID preservation, cloud merge, paid-only expense publication');
