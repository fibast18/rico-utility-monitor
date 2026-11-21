// Synthetic authorization UI and Firebase regression: no live project accessed.
// Verify a tap reports status, authorizes only finance_viewer, handles repeat taps,
// and never overwrites an existing account or edits household records.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync('index.html','utf8');
assert.match(html,/case 'finance-grant':authorizeFinanceDevice\(\);break;/);
assert.match(html,/financeFeedback\('Connecting to Firebase to authorize this device/);
assert.match(html,/async function initializeFirebaseSync\(\)/);
assert.match(html,/firebaseSyncPromise=null;throw error/,'Failed module load must be retryable');

let source=readFileSync('firebase-sync.js','utf8');
source=source.replace("import { buildFinancePaidSnapshot } from './utility-finance-bridge.js';",
  'const buildFinancePaidSnapshot=()=>({schema:1,source:"test",entries:[]});');
source=source.replace('export function createSync(', 'function createSync(');
source=source.replace(
  /const \[app, auth, db\] = await Promise\.all\(\[[\s\S]*?\]\);/,
  'const [app, auth, db] = globalThis.__mockSDK;'
);
assert(!source.includes("import(sdk + 'firebase-app.js')"),'SDK should be mocked');
source+='\nglobalThis.__createSync=createSync;';

const documents=new Map([
 ['authorizedDevices/home-writer',{enabled:true,role:'owner',addedAt:'2026-01-01'}]
]);
let writes=[],writeAllowed=true,offline=false;
const fakeDb={
 getFirestore:()=>({}),
 doc:(_store,...segments)=>segments.join('/'),
 async getDocFromServer(path){
  if(!writeAllowed)throw Object.assign(Error('Missing or insufficient permissions'),{code:'permission-denied'});
  if(path==='household/utilities')return {exists:()=>true,data:()=>({schema:1})};
  const value=documents.get(path);
  return {exists:()=>value!==undefined,data:()=>value};
 },
 async setDoc(path,value){
  assert(path.startsWith('authorizedDevices/'),'Approval may not write household records');
  assert.equal(documents.has(path),false,'Existing member must never be overwritten');
  assert.equal(value.role,'finance_viewer');
  assert.equal(value.enabled,true);
  writes.push({path,value});
  documents.set(path,value);
 }
};
const messages=[];
const navigator={get onLine(){return !offline;}};
const ctx={
 console,Date,Math,JSON,Promise,Set,Map,TextEncoder,
 navigator,document:{addEventListener(){}},
 addEventListener(){},setTimeout(){},clearTimeout(){},confirm:()=>true,
 globalThis:null,__mockSDK:[
  {initializeApp:()=>({})},
  {getAuth:()=>({
    authStateReady:async()=>{},currentUser:{uid:'home-writer'}
   })},
  fakeDb
 ]
};
ctx.globalThis=ctx;
new Script(source,{filename:'firebase-sync.js testable source'}).runInContext(createContext(ctx));
const sync=ctx.__createSync({
 read:()=>({records:[],dailyReadings:[],camellaDues:{entries:[],beginningBalance:0},cogeaCbuOverrides:{}}),
 baseline:null,persist(){},display:x=>messages.push(x)
});
const deviceId='finance-device-0123456789';
assert.equal(await sync.grantFinanceReader(deviceId),true);
assert.equal(writes.length,1,'One viewer-only approval written');
assert.equal(writes[0].path,'authorizedDevices/'+deviceId);
assert.match(messages.at(-1).financeStatus,/Success! Read-only device authorized/);
assert.equal(await sync.grantFinanceReader(deviceId),true);
assert.equal(writes.length,1,'Second tap idempotent');
assert.match(messages.at(-1).financeStatus,/Already authorized/);
documents.set('authorizedDevices/another-household-device',
 {enabled:true,role:'owner',addedAt:'2026-01-01'});
assert.equal(await sync.grantFinanceReader('another-household-device'),false);
assert.equal(writes.length,1,'Must not overwrite existing writers');
assert.match(messages.at(-1).financeStatus,/No existing permissions were changed/);
writeAllowed=false;
assert.equal(await sync.grantFinanceReader('finance-other-device-123456'),false);
assert.match(messages.at(-1).financeStatus,/Firebase denied access/);
writeAllowed=true;
offline=true;
assert.equal(await sync.grantFinanceReader('finance-offline-device-123456'),false);
assert.match(messages.at(-1).financeStatus,/Internet is required/);
assert.equal(writes.length,1);
console.log('PASS: responsive device approval, reader-only Firebase write, repeat idempotency, permission and offline feedback');
