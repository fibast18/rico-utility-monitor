import { buildFinancePaidSnapshot } from './utility-finance-bridge.js';

const config = {
  apiKey: "AIzaSyDfneSHThNcQ207t1g7OzJVfaUIrNVh2jo",
  authDomain: "rico-home-utilities.firebaseapp.com",
  projectId: "rico-home-utilities",
  storageBucket: "rico-home-utilities.firebasestorage.app",
  messagingSenderId: "153885893969",
  appId: "1:153885893969:web:6d3cc90243b3bd2d51df70"
};

const sdk = 'https://www.gstatic.com/firebasejs/13.4.0/';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const camellaKey = row => row.autoMonthly ? 'auto:' + row.date.slice(0, 7) : 'row:' + row.id;

// Never let Map silently discard an imported bill with a duplicate legacy ID.
// Mirror index.html's deterministic ID repair without modifying input records
// until a successful cloud transaction has saved the reconciled documents.
function uniqueRecords(records) {
  const all = new Set(records.map(row => String(row.id))), seen = new Set();
  return records.map(row => {
    const original=String(row.id);
    if(!seen.has(original)) {seen.add(original);return row;}
    let suffix=2,replacement='';
    do {replacement=original.slice(0,90)+'-duplicate-'+suffix++;} while(all.has(replacement));
    all.add(replacement);seen.add(replacement);
    return {...row,id:replacement};
  });
}

function entries(data) {
  return new Map([
    ...uniqueRecords(data.records).map(row => ['record/' + row.id, row]),
    ...data.dailyReadings.map(row => ['meter/' + row.date, row]),
    ...data.camellaDues.entries.map(row => ['camella/' + camellaKey(row), row]),
    ...Object.entries(data.cogeaCbuOverrides).map(([date, amount]) => ['cogea/' + date, amount]),
    ['balance', data.camellaDues.beginningBalance]
  ]);
}

function merge(base, local, remote) {
  const prior = entries(base), mine = entries(local), merged = entries(remote);
  for (const key of new Set([...prior.keys(), ...mine.keys()])) {
    if (same(prior.get(key), mine.get(key))) continue;
    if (key.startsWith('camella/auto:') && !prior.has(key) && merged.has(key)) continue;
    if (mine.has(key)) merged.set(key, mine.get(key));
    else merged.delete(key);
  }
  const byType = type => [...merged].filter(([key]) => key.startsWith(type + '/'));
  return {
    records: byType('record').map(([, value]) => value),
    dailyReadings: byType('meter').map(([, value]) => value),
    camellaDues: { beginningBalance: merged.get('balance'), entries: byType('camella').map(([, value]) => value) },
    cogeaCbuOverrides: Object.fromEntries(byType('cogea').map(([key, value]) => [key.slice(6), value]))
  };
}

function encode(data) {
  const payload = JSON.stringify(data);
  if (new TextEncoder().encode(payload).length > 850000) throw Error('Cloud sync size limit reached. Your changes are saved on this device.');
  return { schema: 1, payload };
}

export function createSync({ read, baseline, persist, display }) {
  let connection, device = '', busy = false, attempted = false, authorized = false;
  let message = 'Sync is off. Get this installation’s device ID to authorize it.';
  let timer;
  let subscribed = false;
  let hasCloud = false;
  let remoteChanged = false;
  let financeStatus = 'For Rico Finances AI, authorize its connection ID once in this app.';
  let lastFinancePublished = '';
  let financePublishSucceeded = false;

  function show(text = message) {
    message = text;
    display({ device, message, busy, allowStart: authorized && !baseline, hasCloud, financeStatus });
  }

  function report(error) {
    if (error.code === 'permission-denied') {
      authorized = false;
      show('This installation is waiting for Firebase authorization. After allowing its device ID, tap Check connection.');
    } else {
      show(error.message || 'Cloud sync is unavailable. Your records are saved on this device.');
    }
  }

  async function connect() {
    if (connection) return connection;
    const [app, auth, db] = await Promise.all([
      import(sdk + 'firebase-app.js'), import(sdk + 'firebase-auth.js'), import(sdk + 'firebase-firestore.js')
    ]);
    const instance = app.initializeApp(config);
    const identity = auth.getAuth(instance);
    await identity.authStateReady();
    const user = identity.currentUser || (await auth.signInAnonymously(identity)).user;
    device = user.uid;
    const store = db.getFirestore(instance);
    connection = { db, ref: db.doc(store, 'household', 'utilities'), store };
    show();
    return connection;
  }

  function decode(snapshot) {
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (data.schema !== 1 || typeof data.payload !== 'string') throw Error('Unrecognized cloud records. Local records were preserved.');
    const state = JSON.parse(data.payload);
    entries(state);
    return state;
  }

  // Publish only a minimal paid-expense snapshot, never full utility records.
  // Re-read the *server* summary on each confirmed source sync. Otherwise a
  // second household device can overwrite the snapshot while this app keeps
  // incorrectly assuming its last in-memory fingerprint is still published.
  async function publishPaidSummary(cloud) {
    if(!cloud)return false;
    try {
      const summary=buildFinancePaidSnapshot(cloud);
      const fingerprint=JSON.stringify(summary);
      const {db,store}=await connect();
      const ref=db.doc(store,'household','financePaidUtilities');
      const published=await db.getDocFromServer(ref);
      const old=published.exists()?published.data():null;
      const previous=old?JSON.stringify({
        schema:old.schema,source:old.source,entries:old.entries,
        dateBasis:old.dateBasis
      }):'';
      if(previous!==fingerprint){
        await db.setDoc(ref,{...summary,updatedAt:new Date().toISOString()});
      }
      lastFinancePublished=fingerprint;
      financePublishSucceeded=true;
      financeStatus='Paid Home Utilities are synced with Rico Finances AI (read-only).';
      show();
      return true;
    } catch(error) {
      financePublishSucceeded=false;
      const code=String(error?.code||'');
      financeStatus='Paid bills NOT linked to Rico Finances AI: '+
        (code==='permission-denied'
          ? 'Firebase refused summary access. Publish the updated Firestore rules; utility cloud sync remains separate.'
          : String(error?.message||error).slice(0,155));
      show();
      return false;
    }
  }

  // The button must never silently exit. Verify this device is an authorized
  // household writer on every approval request, then create *only* the viewer role.
  // Repeat taps return "Already approved" instead of trying an update forbidden
  // by the least-privilege Firestore rules.
  async function grantFinanceReader(uid) {
    const id=String(uid||'').trim();
    if(!/^[A-Za-z0-9_-]{10,160}$/.test(id)){
      financeStatus='Enter a valid Finances connection ID (not the Home Utilities device ID).';
      show();return false;
    }
    if(navigator.onLine===false){
      financeStatus='Internet is required to approve a Finances device. Reconnect and tap Authorize again.';
      show();return false;
    }
    financeStatus='Checking Home Utilities authorization…';
    show();
    try {
      const {db,store,ref}=await connect();
      if(id===device){
        financeStatus='The Finances ID must be different from this Home Utilities device ID.';
        show();return false;
      }
      // Firestore GET is restricted to existing household writers. A finance
      // viewer cannot authorize another device, even if it calls this function.
      await db.getDocFromServer(ref);
      authorized=true;
      const target=db.doc(store,'authorizedDevices',id);
      const existing=await db.getDocFromServer(target);
      if(existing.exists()){
        const member=existing.data()||{};
        financeStatus=member.enabled===true&&member.role==='finance_viewer'
          ? 'Already authorized! Open Rico Finances AI → Linked Utilities → Connect now.'
          : 'This ID already belongs to a different account. No existing permissions were changed.';
        show();
        return member.enabled===true&&member.role==='finance_viewer';
      }
      financeStatus='Authorizing read-only Finances device…';
      show();
      await db.setDoc(target,{enabled:true,role:'finance_viewer',
        addedAt:new Date().toISOString()});
      financeStatus='Success! Read-only device authorized. Open Rico Finances AI → Linked Utilities → Connect now.';
      show();return true;
    } catch(error) {
      const code=String(error?.code||'');
      financeStatus='Approval failed: '+(code==='permission-denied'
        ? 'Firebase denied access. Confirm this Home Utilities device is authorized and the updated Firestore rules are published.'
        : code==='unavailable'
          ? 'Firebase is unavailable. Check the internet connection and try again.'
          : String(error?.message||error||'Unknown Firebase error').slice(0,160));
      show();return false;
    }
  }

  async function run(mode, expected) {
    if (busy) return;
    busy = true;
    attempted = true;
    show('Checking Firebase…');
    try {
      const { db, ref, store } = await connect();
      const local = read();
      const prior = baseline;
      let cloud;
      if (mode === 'sync' && !prior) {
        cloud = decode(await db.getDocFromServer(ref));
      } else {
        cloud = await db.runTransaction(store, async transaction => {
          const remote = decode(await transaction.get(ref));
          if (mode === 'seed') {
            if (remote) throw Error('Cloud already contains records. Check the connection before continuing.');
            transaction.set(ref, encode(local));
            return local;
          }
          if (!remote) throw Error('Cloud records are missing. Local records were preserved.');
          if (mode === 'join') return remote;
          const next = merge(prior, local, remote);
          if (!same(next, remote)) transaction.set(ref, encode(next));
          return next;
        });
      }
      authorized = true;
      hasCloud = Boolean(cloud);
      if (mode === 'join' && !same(read(), expected)) throw Error('This device changed while connecting. Check its backup before joining again.');
      if ((prior || mode !== 'sync') && cloud) {
        const current = read();
        const next = mode === 'join' ? cloud : merge(local, current, cloud);
        persist(next, cloud);
        baseline = cloud;
        if (!same(next, cloud)) schedule();
      }
      if (!subscribed) {
        subscribed = true;
        const unsubscribe = db.onSnapshot(ref, snapshot => {
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
          if (baseline) {
            try {
              if (!same(decode(snapshot), baseline)) {
                if (busy) remoteChanged = true;
                else schedule();
              }
            }
            catch (error) { report(error); }
          }
        }, error => {
          unsubscribe();
          subscribed = false;
          report(error);
        });
      }
      if(cloud)await publishPaidSummary(cloud);
      show(financePublishSucceeded
        ? (baseline ? 'Connected. Utility changes sync automatically; paid bills also sync to Finances.' :
            'Cloud authorization ready. Paid bills will sync when the household records are available.')
        : financeStatus.startsWith('Paid bills NOT linked')
          ? 'Utility cloud sync connected, but '+financeStatus
          : (baseline ? 'Connected. Changes sync automatically while online.' :
             hasCloud ? 'Cloud records are available. Join only after backing up this device.' :
             'Authorized. Back up this device before starting the first upload.'));
    } catch (error) {
      report(error);
    } finally {
      busy = false;
      show();
      if (baseline && navigator.onLine && authorized && (remoteChanged || !same(read(), baseline))) {
        remoteChanged = false;
        schedule(5000);
      }
    }
  }

  function schedule(delay = 500) {
    clearTimeout(timer);
    timer = setTimeout(() => run('sync'), delay);
  }

  addEventListener('online', () => { if (attempted || baseline) schedule(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && baseline) schedule();
  });

  show();
  if (baseline) schedule();
  return {
    check: () => run('sync'),
    saved: () => {
      if (!baseline) return;
      if (navigator.onLine) schedule();
      else show('Saved on this device. Changes will sync when you reconnect.');
    },
    start() {
      if (!authorized || baseline || busy) return;
      const mode = hasCloud ? 'join' : 'seed';
      const local = read();
      if (mode === 'join' && (local.records.length || local.dailyReadings.length ||
        local.camellaDues.beginningBalance || local.camellaDues.entries.some(row => !row.autoMonthly) ||
        Object.keys(local.cogeaCbuOverrides).length)) {
        show('This device has its own records. Export both devices’ JSON backups so the records can be reconciled before joining.');
        return;
      }
      const prompt = mode === 'join' ? 'Load the shared cloud records on this device?' :
        'Upload the records on this device to your private Firebase database? Export a JSON backup first.';
      if (confirm(prompt)) run(mode, local);
    },
    refresh: () => show(),
    grantFinanceReader
  };
}
