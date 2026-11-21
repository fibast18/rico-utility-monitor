// Synthetic read-only finance snapshot test. Does not access Firebase or real bills.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync('utility-finance-bridge.js','utf8');
const {buildFinancePaidSnapshot}=await import('data:text/javascript,'+encodeURIComponent(src));
const state={
 records:[
  {id:'elec-1',type:'electricity',status:'paid',date:'2026-11-10',amount:1899.35,note:'private note',previous:44,current:88},
  {id:'water-1',type:'water',status:'unpaid',date:'2026-11-11',amount:350},
  {id:'fuel-1',type:'car',status:'paid',date:'2026-11-12',amount:900},
  {id:'lpg-1',type:'lpg',status:'paid',date:'2026-11-14',amount:1100}
 ],
 dailyReadings:[{date:'2026-11-14',reading:98765}],
 camellaDues:{beginningBalance:100,entries:[
  {id:'hoa1',date:'2026-11-01',arrears:300,payment:300,orNumber:'SECRET-RECEIPT',orDate:'2026-11-05'},
  {id:'hoa2',date:'2026-12-01',arrears:300,payment:0}
 ]},
 cogeaCbuOverrides:{'2026-11-20':25000}
};
const result=buildFinancePaidSnapshot(state);
assert.equal(result.schema,1);
assert.equal(result.entries.length,4);
assert.equal(result.entries.reduce((s,e)=>s+e.amount,0),4199.35);
assert.deepEqual(result.entries.map(e=>e.type).sort(),['camella','car','electricity','lpg']);
assert.equal(result.entries.find(e=>e.type==='camella').date,'2026-11-05','Use OR date when present');
const serialized=JSON.stringify(result);
for(const privateField of ['private note','SECRET-RECEIPT','reading','cogea','previous','current','beginningBalance','arrears']){
 assert(!serialized.includes(privateField),'Private source field leaked: '+privateField);
}
assert(!result.entries.some(e=>e.id.includes('water')),'Unpaid utility must never enter Cash Flow');
const rules=readFileSync('firestore.rules','utf8');
assert.match(rules,/membership\(\)\.get\('role', ''\) != 'finance_viewer'/);
assert.match(rules,/match \/household\/financePaidUtilities/);
assert.match(rules,/match \/household\/utilities\s*\{\s*allow get: if writer\(\)/);
console.log('PASS: paid-only narrow utility extract, receipt date, no unpaid/COGEA/meter/notes, finance viewer restrictions');
