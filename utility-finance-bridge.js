/* Read-only family expense extract for Rico Finances AI.
 * The FULL utilities document never becomes visible to a finance_viewer.
 * This module does not mutate utility records or write financial transactions.
 */
const TYPES={
 electricity:'Electricity',water:'Water',car:'Car Fuel',
 motorcycle:'Motorcycle Fuel',lpg:'LPG / Cooking Gas'
};
const validDate=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T12:00:00Z'));
const money=n=>Math.round(Number(n)*100)/100;
export function buildFinancePaidSnapshot(data) {
 const entries=[],ids=new Set();
 const add=(id,type,date,amount)=>{
  const value=Number(amount);
  if(typeof id!=='string'||!id||id.length>160||!validDate(date)||
     !Number.isFinite(value)||value<=0||value>1e12)return;
  const key=type+':'+id;
  if(ids.has(key))throw Error('Duplicate paid utility ID. Reconcile utilities before publishing.');
  ids.add(key);
  entries.push({id:key,type,date,amount:money(value),
   name:type==='camella'?'Camella Monthly Dues':TYPES[type]});
 };
 for(const r of data?.records||[]) {
  if(!r||!Object.hasOwn(TYPES,r.type)||r.status==='unpaid')continue;
  // Existing app records bill/purchase date and paid status, not payment timestamp.
  // Never invent a precise payment date.
  add(String(r.id||''),r.type,r.date,r.amount);
 }
 for(const r of data?.camellaDues?.entries||[]) {
  if(!r||Number(r.payment)<=0)continue;
  add(String(r.id||''),'camella',validDate(r.orDate)?r.orDate:r.date,r.payment);
 }
 if(entries.length>3500)throw Error('Too many paid transactions for the Finances link.');
 entries.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const encoded=JSON.stringify(entries);
 if(new TextEncoder().encode(encoded).length>740000)throw Error('Paid utility snapshot exceeds safe cloud document size.');
 return {schema:1,source:'rico-utility-monitor',entries,dateBasis:'bill-or-record-date'};
}
