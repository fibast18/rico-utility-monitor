// Synthetic Firebase integration: paid expense status must publish to the
// read-only finance document, including after another device overwrites it.
// Never connects to real Firebase or touches any user data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';
const bridgeCode=readFileSync('utility-finance-bridge.js','utf8');
const {buildFinancePaidSnapshot}=await import('data:text/javascript,'+encodeURIComponent(bridgeCode));

let source=readFileSync('firebase-sync.js','utf8');
source=source.replace("import { buildFinancePaidSnapshot } from './utility-finance-bridge.js';",
 'const buildFinancePaidSnapshot=globalThis.__buildFinancePaidSnapshot;');
source=source.replace('export function createSync(', 'function createSync(');
source=source.replace(
 /const \[app, auth, db\] = await Promise\.all\(\[[\s\S]*?\]\);/,
 'const [app, auth, db] = globalThis.__mockSDK;'
);
assert(!source.includes("import(sdk + 'firebase-app.js')"),'Firebase imports are replaced with safe test mocks');
source+='\nglobalThis.__createSync=createSync;';

const initial={
 records:[
  {id:'electricity-A',type:'electricity',date:'2026-11-02',amount:1200,status:'unpaid',updatedAt:'2026-11-02'},
  {id:'water-B',type:'water',date:'2026-11-04',amount:350,status:'unpaid',updatedAt:'2026-11-04'},
  {id:'fuel-C',type:'car',date:'2026-11-09',amount:800,status:'paid',updatedAt:'2026-11-09'}
 ],
 dailyReadings:[],camellaDues:{entries:[],beginningBalance:0},
 cogeaCbuOverrides:{}
};
let local=structuredClone(initial),baseline=structuredClone(initial),cloud=structuredClone(initial);
let financeDoc=null,financeWrites=0,failPaidSummary=false;
const status=[];
const fakeDb={
 getFirestore:()=>({}),
 doc:(_store,...parts)=>parts.join('/'),
 async runTransaction(_store,fn){
  const changes=[];
  const tx={
   async get(path){
    if(path==='household/financePaidUtilities')return {exists:()=>financeDoc!==null,data:()=>structuredClone(financeDoc)};
    assert.equal(path,'household/utilities');
    return {exists:()=>true,data:()=>({schema:1,payload:JSON.stringify(cloud)})};
   },
   set(path,value){changes.push({path,value})}
  };
  const returned=await fn(tx);
  for(const change of changes){
   if(change.path==='household/financePaidUtilities'){
    if(failPaidSummary)throw Object.assign(Error('simulated permission issue'),{code:'permission-denied'});
    financeDoc=structuredClone(change.value);
    financeWrites++;
    continue;
   }
   assert.equal(change.path,'household/utilities');
   cloud=JSON.parse(change.value.payload);
  }
  return returned;
 },
 onSnapshot(){return ()=>{}}
};
const context={
 console,Date,Math,JSON,Promise,Set,Map,TextEncoder,structuredClone,
 navigator:{onLine:true},document:{addEventListener(){}},
 addEventListener(){},setTimeout(){return 1},clearTimeout(){},confirm(){return true},
 __buildFinancePaidSnapshot:buildFinancePaidSnapshot,
 __mockSDK:[
  {initializeApp:()=>({})},
  {getAuth:()=>({authStateReady:async()=>{},currentUser:{uid:'home-writer'}})},
  fakeDb
 ]
};
context.globalThis=context;
new Script(source,{filename:'firebase-sync.js mocked publisher'})
 .runInContext(createContext(context));
const sync=context.__createSync({
 read:()=>structuredClone(local),
 baseline,
 persist:(next,remote)=>{local=structuredClone(next);baseline=structuredClone(remote)},
 display:data=>status.push(data)
});
function change(id,newStatus){
 const row=local.records.find(x=>x.id===id);
 assert(row);row.status=newStatus;row.updatedAt=new Date().toISOString();
}

change('water-B','paid');
await sync.check();
assert.equal(local.records.length,3);
assert.equal(local.records.find(x=>x.id==='electricity-A').status,'unpaid',
 'Changing Water must not touch Electricity');
assert.equal(financeWrites,1);
assert.deepEqual(financeDoc.entries.map(x=>x.type).sort(),['car','water']);
assert.equal(financeDoc.entries.reduce((v,x)=>v+x.amount,0),1150);

change('water-B','unpaid');
await sync.check();
assert.equal(financeWrites,2);
assert.deepEqual(financeDoc.entries.map(x=>x.type),['car']);
assert.equal(financeDoc.entries[0].amount,800);

change('electricity-A','paid');
await sync.check();
assert.equal(financeWrites,3);
assert.deepEqual(financeDoc.entries.map(x=>x.type).sort(),['car','electricity']);
assert.equal(financeDoc.entries.reduce((v,x)=>v+x.amount,0),2000);
// A second device may have republished an obsolete snapshot while this one was open.
financeDoc={...financeDoc,entries:[]};
await sync.check();
assert.equal(financeWrites,4,'Must repair stale published summary on next successful sync');
assert.equal(financeDoc.entries.length,2);
failPaidSummary=true;
change('electricity-A','unpaid');
await sync.check();
assert.equal(local.records.find(x=>x.id==='electricity-A').status,'unpaid');
assert.equal(cloud.records.find(x=>x.id==='electricity-A').status,'unpaid',
 'A summary-permission error must not roll back source utility data');
assert.match(status.at(-1).message,/Paid bills NOT linked/);
assert.match(status.at(-1).financeStatus,/Firebase refused summary access/);
assert.equal(financeWrites,4);
console.log('PASS: paid/unpaid summary auto-publish, stale snapshot correction, independent records, and permission failures isolated');
