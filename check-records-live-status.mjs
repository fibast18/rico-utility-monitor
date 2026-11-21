// Synthetic UI regression: cloud sync updates must repaint the Records tab,
// and device/Finances status must never be misrepresented as connected.
// This test contains no private records or network calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync('index.html','utf8');
assert.match(html,/id="utilityCloudBadge"/,'Header must have dynamic cloud state');
assert.match(html,/id="recordSyncNotice"/,'Records tab needs a live sync status');
assert.match(html,/if\(changed&&\(page==='overview'\|\|page==='records'\)\)render\(\)/,
 'After cloud reconciliation, both Overview and Records must be redrawn');
assert.match(html,/showSyncEverywhere\(\{device,message,busy,allowStart,hasCloud,financeStatus\}\)/,
 'Firebase progress must update the entire app even outside Backup');
const start=html.indexOf('function showSyncEverywhere(view){');
const end=html.indexOf('\ntry{const raw=localStorage.getItem(KEY)',start);
assert(start>=0&&end>start,'Expected live status handler');
const badge={textContent:'',title:''},notice={textContent:''};
const navigator={onLine:true};
const context={navigator,document:{
 getElementById:id=>id==='utilityCloudBadge'?badge:id==='recordSyncNotice'?notice:null
}};
new Script('let latestSyncView=null;\n'+html.slice(start,end)+'\nglobalThis.show=showSyncEverywhere')
 .runInContext(createContext(context));
context.show({message:'Connected. Changes sync automatically while online.',
 financeStatus:'Paid utility summary published to Firebase: 3 paid entries · ₱2,061.00.'});
assert.equal(badge.textContent,'Cloud synced · Finance published');
assert.match(notice.textContent,/Paid summaries published/);
context.show({message:'Connected. Changes sync automatically while online.',
 financeStatus:'Paid bills NOT linked to Rico Finances AI: Firebase refused summary access.'});
assert.equal(badge.textContent,'Cloud synced · Finance pending');
assert.match(notice.textContent,/NOT linked/);
context.show({message:'This installation is waiting for Firebase authorization.',
 financeStatus:'For Rico Finances AI, authorize its connection ID once in this app.'});
assert.equal(badge.textContent,'Device approval needed');
navigator.onLine=false;
context.show({message:'Connected. Changes sync automatically while online.',
 financeStatus:'Paid utility summary published to Firebase: 3 paid entries'});
assert.equal(badge.textContent,'Offline · saved locally');
console.log('PASS: Records refreshes after cloud changes; live header and finance statuses are accurately displayed');
