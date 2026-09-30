require('../lib/diff.js'); const T = globalThis.Tripwire; const assert = require('assert');
const apply = (ops, side) => ops.filter(o => o.t === '=' || o.t === side).map(o => o.s).join('');
const cases = [
  ['Waitlist: 12 seats', 'Waitlist: 11 seats'],
  ['', 'hello world'], ['hello world', ''],
  ['a b c d e f', 'a x c d y f z'],
  ['Status: Closed\nNext update Monday', 'Status: Open\nNext update Monday\nApply now'],
];
// random fuzz
for (let i = 0; i < 300; i++) {
  const w = () => Array.from({length: Math.floor(Math.random()*40)}, () => 'abcde'[Math.floor(Math.random()*5)]).join(' ');
  cases.push([w(), w()]);
}
for (const [a, b] of cases) {
  const ops = T.diff(a, b);
  assert.strictEqual(apply(ops, '-'), a, 'old reconstruct');
  assert.strictEqual(apply(ops, '+'), b, 'new reconstruct');
}
const ops = T.diff('Waitlist: 12 seats', 'Waitlist: 11 seats');
console.log(JSON.stringify(ops), T.summarize(ops), T.similarity(ops).toFixed(2));
// big input
const big = Array.from({length: 20000}, (_, i) => 'w' + i).join(' ');
let t = Date.now(); const bo = T.diff(big, big.replace('w500 ', 'CHANGED ')); console.log('big ms', Date.now()-t, T.summarize(bo));
console.log('all diff tests passed:', cases.length);
