const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../services/aggregations.js'), 'utf8');
function load(events) {
  const calls = [];
  const query = {
    select: () => query, sort: x => (calls.push(['sort', x]), query),
    lean: () => query, maxTimeMS: () => query,
    cursor: () => ({ async *[Symbol.asyncIterator]() { for (const e of events) yield e; } }),
  };
  const Event = { find: filter => (calls.push(['find', filter]), query), aggregate: () => { throw new Error('unexpected aggregation'); } };
  const mod = { exports: {} };
  vm.runInNewContext('(function(require,module,exports){' + source + '\n})', { process, Set })(() => Event, mod, mod.exports);
  return { service: mod.exports, calls };
}
test('lifetime loyalty streaming counts user purchase events without MongoDB group', async () => {
  const { service, calls } = load([
    {userId:'a'}, {userId:'a'}, {userId:'a'}, {userId:'b'}, {userId:'c'}, {userId:'c'},
  ]);
  const ids = await service.getLoyalUserIds('p1');
  assert.deepEqual([...ids], ['a','c']);
  assert.equal(calls[0][1].projectId,'p1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), {userId:1});
});
