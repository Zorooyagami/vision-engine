const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
// Pure decision rules can be exercised independently of MongoDB connectivity.
const pathToModule = path.resolve(__dirname,'../services/decisionIntelligence.js');
const source = fs.readFileSync(pathToModule,'utf8');
const moduleMock = {exports:{}};
vm.runInNewContext(source,{module:moduleMock,exports:moduleMock.exports,require:(name)=>({}),Date,Map,Set,Number,String,Math,console,process});
const {createRecommendations,dateWindow} = moduleMock.exports;
test('date window rejects future or unsupported ranges',()=>{
 assert.throws(()=>dateWindow({period:'wrong'}));
 assert.throws(()=>dateWindow({period:'custom',from:'2026-01-01',to:'2028-01-01'},new Date('2026-11-20')));
 const {start,end} = dateWindow({period:'30d'},new Date('2026-11-20'));
 assert.equal(Math.round((end-start)/864e5),30);
});
test('rules produce evidence-backed recommendations, not hardcoded metrics',()=>{
 const counts=[
  {_id:'add_to_cart',count:90,sessions:Array.from({length:60},(_,i)=>'c'+i)},
  {_id:'checkout_start',count:15,sessions:Array.from({length:15},(_,i)=>'o'+i)},
  {_id:'payment_failed',count:12,sessions:[]},
  {_id:'checkout_step_error',count:8,sessions:[]},
  {_id:'product_stock_unavailable',count:5,sessions:[]}
 ];
 const products=[{_id:{event:'product_view',id:4},count:42,name:'Sample product'}, {_id:{event:'purchase',id:4},count:1}];
 const output=createRecommendations({counts,products,devices:[],searches:[{_id:'zero',count:8},{_id:'other',count:12}],days:30});
 assert.ok(output.some(x=>x.key==='di:cart-progression'));
 assert.ok(output.some(x=>x.key==='di:product-4'));
 assert.ok(output.some(x=>x.key==='di:zero-search'));
 assert.ok(output.every(x=>x.evidence && x.score>=0 && x.score<=100));
});
test('low sample does not invent opportunities',()=>{
 const output=createRecommendations({counts:[],products:[],devices:[],searches:[],days:1});
 assert.equal(output.length,0);
});

test('stock investigations display product names and search/checkout details retain specific evidence',()=>{
 const counts=[{_id:'product_stock_unavailable',count:9,sessions:[]},{_id:'checkout_step_error',count:6,sessions:[]},{_id:'search_performed',count:15,sessions:[]}];
 const products=[{_id:{event:'product_view',id:7},count:2,name:'Example AirPods'}];
 const breakdowns={stockProducts:[{_id:7,count:9}],checkoutSteps:[{_id:'shipping',count:6}],checkoutErrorCodes:[{_id:'INVALID_POSTCODE',count:4}],searchQueries:[{_id:'rare keyboard',count:6}]};
 const rows=createRecommendations({counts,products,devices:[],searches:[{_id:'zero',count:6},{_id:'other',count:9}],breakdowns,days:30});
 const stock=rows.find(r=>r.key==='di:stock-issues');
 assert.match(stock.details.stockProducts[0].label,/Example AirPods/);
 assert.equal(rows.find(r=>r.key==='di:checkout-errors').details.checkoutErrorCodes[0].label,'INVALID_POSTCODE');
 assert.equal(rows.find(r=>r.key==='di:zero-search').details.searchQueries[0].label,'rare keyboard');
});
