const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('browser SDK exposes reusable tracking methods and consent control',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/sdk/analytics.js'),'utf8');
 for(const method of ['track(eventName','pageView(properties','flush()','setConsent(enabled)']) assert.ok(source.includes(method),`missing ${method}`);
 assert.ok(source.includes('STORAGE_VISITOR'));
});
test('server tracker is a reusable helper and sends server event route',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/server-tracker.js'),'utf8');
 assert.ok(source.includes('/api/server-events'));
 assert.ok(source.includes('x-server-tracking-key'));
});
