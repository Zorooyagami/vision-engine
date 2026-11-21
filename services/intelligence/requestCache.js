'use strict';
// Short-lived, bounded project-scoped single-flight cache. Never cache failures.
const completed = new Map();
const pending = new Map();
const MAX_ENTRIES = 120;
function sortedQuery(query) {
 return Object.entries(query || {}).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,Array.isArray(v)?v.map(String):String(v)]);
}
async function cachedAnalytics(namespace, req, compute, ttlMs = 30000) {
 const project = req.projectId || req.project?.projectId;
 if (!project) return compute();
 const key=JSON.stringify([namespace,project,sortedQuery(req.query)]);
 const old=completed.get(key);
 if(old && Date.now()-old.time<ttlMs)return old.value;
 if(pending.has(key))return pending.get(key);
 const promise=Promise.resolve().then(compute);
 pending.set(key,promise);
 try {
  const value=await promise;
  completed.set(key,{value,time:Date.now()});
  while(completed.size>MAX_ENTRIES)completed.delete(completed.keys().next().value);
  return value;
 } finally { pending.delete(key); }
}
module.exports = {cachedAnalytics};
