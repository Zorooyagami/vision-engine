const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function loadWithMocks(file, mocks) {
  const code = fs.readFileSync(file,'utf8');
  const mod = {exports:{}};
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {}, {filename:file})(name => {
    if (!(name in mocks)) throw new Error(`Unexpected require ${name}`);
    return mocks[name];
  }, mod, mod.exports);
  return mod.exports;
}
const root=path.join(__dirname,'..');
test('homepage reads only selected period and aggregates actual session events', async()=>{
 let pipeline, options;
 const rows=[{ sessions:8, events:50, purchasingSessions:3, identifiedSessions:5 }];
 const Event={aggregate(q){pipeline=q;return {option(o){options=o;return Promise.resolve(rows)}}}};
 const {getHomeSummary}=loadWithMocks(path.join(root,'services/intelligence/homeSummary.js'),{
  '../../models/Event':Event,
  '../exploreFilters':{readReportingFilters:()=>({projectId:'p', start:new Date('2026-01-01'), end:new Date('2026-02-01'), platform:'combined'})},
  '../filterHelpers':{applyPlatformDeviceFilter(){}}
 });
 const result=await getHomeSummary({});
 assert.equal(result.current.sessions,8); assert.equal(result.current.purchasingSessions,3);
 assert.equal(result.facts.length,2);assert.equal(pipeline.length,3);
 assert.equal(pipeline[0].$match.projectId,'p'); assert.equal(options.maxTimeMS,15000);
});
test('fallback insight generator does not make up observations for empty data',()=>{
 const text=fs.readFileSync(path.join(root,'services/llmInsights.js'),'utf8');
 const start=text.indexOf('function evidenceInsights(facts)');
 const end=text.indexOf('async function synthesizeInsights',start);
 const context={};vm.runInNewContext(text.slice(start,end)+'\nthis.evidenceInsights=evidenceInsights',context);
 assert.equal(context.evidenceInsights({generic:{current:{overallSessionCount:0}}}).length,0);
 const evidence=context.evidenceInsights({generic:{current:{overallSessionCount:12,overallConversionRate:0.25,bounceRate:0.5},previous:{overallSessionCount:10}}});
 assert.equal(evidence.length,3);assert.match(evidence[0].text,/12 sessions/);
 assert.equal(evidence[0].source,'rules');
});
