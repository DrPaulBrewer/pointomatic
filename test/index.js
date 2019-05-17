/* eslint-env node, mocha */

const assert = require('assert');
const fromEntries = require('object.fromentries');
require('should');
const pointomatic = require('../index.js');
const IoRedis = require('ioredis');

const redisServerLocal = {
  host: "localhost",
  port: 6379,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    return delay;
  }
};

const ioredis = new IoRedis(redisServerLocal);

if (!Object.fromEntries) {
    fromEntries.shim();
}

after(function(){
  ioredis.disconnect();
});

describe('initialize test database: ', function () {
  it('sending FLUSHALL', async function () {
      return await ioredis.flushall();
  });
});

function rand8chars(){
  let s='';
  const a = "A".codePointAt(0);
  while(s.length<8){
    s += String.fromCodePoint([a+Math.floor(26*Math.random())]);
  }
  return s;
}

function reverse(s){
  return String(s).split('').reverse().join('');
}

function testDataset(n){
  const testData = {};
  let i = 0;
  while(i<n){
    const k = rand8chars();
    if (!(['abcdefgh','bbbbbbbb'].includes(k)) && (testData[k]===undefined)){
      testData[k] = Math.floor(1+100*Math.random());
      i++;
    }
  }
  assert(Object.keys(testData).length===n, "randomization of keys incorrect -- please rerun tests");
  return testData;
}


const specs = [
  {
    ioredis,
    name: 'points',
    min: 0,
    max: 150,
    encrypt: reverse,
    decrypt: reverse,
    log: false,
    invalid: (s)=>((typeof(s)!=='string') || (s.length!==8))
  },
  {
    ioredis,
    name: 'points',
    min: 0,
    max: 150,
    encrypt: reverse,
    decrypt: reverse,
    log: true,
    invalid: (s)=>((typeof(s)!=='string') || (s.length!==8))
  }
];

function commonTests(spec, specnumber){
  let points;
  function testGetAll(dataset){
    return async function(){
      const exraw = Object.fromEntries(
        Object.keys(dataset).map((k)=>([points.encrypt(k),dataset[k]]))
      );
      const allRawPairs = await points.getAllRawPairs();
      const allRaw = Object.fromEntries(allRawPairs);
      allRaw.should.deepEqual(exraw);
      const allPairs = await points.getAllPairs();
      const all = Object.fromEntries(allPairs);
      all.should.deepEqual(dataset);
      const rangeRawPairs = await points.getAllRawPairs(points.min,points.max);
      const rangeRaw = Object.fromEntries(rangeRawPairs);
      rangeRaw.should.deepEqual(exraw);
      const rangePairs = await points.getAllPairs(points.min,points.max);
      const range = Object.fromEntries(rangePairs);
      range.should.deepEqual(dataset);
    };
  }
  const dataset10k = testDataset(10000);
  const activatedKeys = (
    Object
    .keys(dataset10k)
    .filter(()=>(Math.random()<0.333))
  );
  const activatedEncryptedKeys = activatedKeys.map(spec.encrypt);
  it('clean init: sending FLUSHALL', async function () {
      return await ioredis.flushall();
  });
  it('preReq: create "activated" set', async function(){
    const result = await ioredis.sadd('activated',activatedEncryptedKeys);
    result.should.deepEqual(activatedKeys.length);
  });
  it('should initialize spec '+specnumber, function(){
    points = pointomatic(spec);
  });
  it('points.ioredis should be an object',function(){
    assert(typeof(points.ioredis)==='object');
  });
  it('points.name should be "points"', function(){
    points.name.should.equal('points');
  });
  it('points.min should be 0', function(){
    points.min.should.equal(0);
  });
  it('points.max should be 150', function(){
    points.max.should.equal(150);
  });
  it('points.encrypt should be a function that returns a string', function(){
    assert(typeof(points.encrypt)==='function');
    const x = points.encrypt('abcdef');
    assert(typeof(x)==='string');
  });
  it('points.invalid should be false for string of length 8', function(){
    points.invalid("abcdefgh").should.equal(false);
  });
  it('points.invalid should be true for string of length 3', function(){
    points.invalid("abc").should.equal(true);
  });
  it('points.invalid() should be true', function(){
    points.invalid().should.equal(true);
  });
  it('points.assertKey should throw for string of length 3', function(){
    function bad(){
      points.assertKey("abc","method");
    }
    bad.should.throw(/method/);
  });
  it('points.assertKey should not throw for string of length 8', function(){
    function ok(){
      points.assertKey("abcdefgh","method");
    }
    ok.should.not.throw();
  });
  it('points.assertRange should not throw for min, max or between', function(){
    points.assertRange(points.min);
    points.assertRange(points.max);
    points.assertRange(0.4*points.min+0.6*points.max);
  });
  it('points.assertRange should throw for max+1', function(){
    function bad(){
      points.assertRange(points.max+1,"method");
    }
    bad.should.throw(/method/);
  });
  it('points.assertRange should throw for min-1', function(){
    function bad(){
      points.assertRange(points.min-1,"method");
    }
    bad.should.throw(/method/);
  });
  it('points.assertRange should throw for nonnumeric', function(){
    function bad(){
      points.assertRange("non-numeric","method");
    }
    bad.should.throw(/method/);
  });
  it('points.assertRange should throw for NaN', function(){
    function bad(){
      points.assertRange(Number.NaN,"method");
    }
    bad.should.throw(/method/);
  });
  it('points.create("abc", 150) should throw invalid key', function(){
    return points.create("abc",150).should.be.rejectedWith(/invalid key/);
  });
  it('points.create("abcdefgh",200) should throw invalid value above max', function(){
    return points.create("abcdefgh", 200).should.be.rejectedWith(/invalid value above max/);
  });
  it('points.create("abcdefgh",-30) should throw invalid value below min', function(){
    return points.create("abcdefgh", -30).should.be.rejectedWith(/invalid value below min/);
  });
  it('points.create("abcdefgh", 150) should yield {key: "abcdefgh", value: 150}', async function(){
    const result = await points.create("abcdefgh",150);
    const expected = {
      key: "abcdefgh",
      value: 150
    };
    result.should.deepEqual(expected);
  });
  it('duplicate points.create("abcdefgh", 100) should throw conflict E', function(){
    return points.create("abcdefgh",100).should.be.rejectedWith(/conflict E/);
  });
  it('nonsense points.create("aaaaaaaa","walrus") should throw non-numeric value', function(){
    return points.create("aaaaaaaa","walrus").should.be.rejectedWith(/non-numeric/);
  });
  it('omitted value points.create("aaaaaaaa") should throw non-numeric value', function(){
    return points.create("aaaaaaaa").should.be.rejectedWith(/non-numeric/);
  });
  it('points.get("abcdefgh") should yield {key: "abcdefgh", value: 150}', async function(){
    const result = await points.get("abcdefgh");
    const expected = {
      key: "abcdefgh",
      value: 150
    };
    result.should.deepEqual(expected);
  });
  it('points.get("aaaaaaaa") should throw non-existent key', function(){
    return points.get("aaaaaaaa").should.be.rejectedWith(/non-existent key/);
  });
  it('points.add("abcdefgh", 50) should throw invalid value above max', function(){
    return points.add("abcdefgh", 50).should.be.rejectedWith(/invalid value above max/);
  });
  it('points.add("abcdefgh",-200) should throw invalid value below min', function(){
    return points.add("abcdefgh",-200).should.be.rejectedWith(/invalid value below min/);
  });
  it('points.add("abcdefgh",-50) should yield {key: "abcdefgh", value: 100, change: -50 }', async function(){
    const result = await points.add("abcdefgh",-50);
    const expected = {
      key: "abcdefgh",
      value: 100,
      change: -50
    };
    result.should.deepEqual(expected);
  });
  it('points.add("abcdefgh","fubar") should throw non-numeric change', function(){
    return points.add("abcdefgh","fubar").should.be.rejectedWith(/non-numeric change/);
  });
  it('points.add("abcdefgh") (omitted change) should throw non-numeric change', function(){
    return points.add("abcdefgh").should.be.rejectedWith(/non-numeric change/);
  });
  it('points.add("bbbbbbbb",20) should throw non-existent key', function(){
    return points.add("bbbbbbbb", 20).should.be.rejectedWith(/non-existent key/);
  });
  it('points.add("cccccccc",-5) should throw non-existent key', function(){
    return points.add("cccccccc",-5).should.be.rejectedWith(/non-existent key/);
  });
  it('points.get("cccccccc") should be rejected with non-existent key ', function(){
    return points.get("cccccccc").should.be.rejectedWith(/non-existent key/);
  });
  it('points.create("bbbbbbbb",30) should yield {key:"bbbbbbbb", value: 30} ', async function(){
    const result = await points.create("bbbbbbbb", 30);
    const expected = {
      key: "bbbbbbbb",
      value: 30
    };
    result.should.deepEqual(expected);
  });
  it('points.getAllRawPairs() returns array of pairs with correct encrypted keys and correct values', async function(){
    const rawpairs = await points.getAllRawPairs();
    const result = Object.fromEntries(rawpairs);
    const expected = {};
    expected[points.encrypt("abcdefgh")] = 100;
    expected[points.encrypt("bbbbbbbb")] = 30;
    result.should.deepEqual(expected);
  });
  it('points.getAllPairs() returns array of pairs with correct keys and values', async function(){
    const pairs = await points.getAllPairs();
    const result = Object.fromEntries(pairs);
    const expected = {
      abcdefgh: 100,
      bbbbbbbb: 30
    };
    result.should.deepEqual(expected);
  });
  it('create 10000 keys, verified random values, outcomes match input specs, getAllRaw, getAll, getCreateReason matches', async function(){
    await Promise.all(Object.entries(dataset10k).map(async ([k,v],n)=>{
      const result = await points.create(k,v,"#"+n);
      result.should.deepEqual({key: k, value: v});
      const readback = await points.get(k);
      readback.should.deepEqual({key: k, value: v});
      if (points.log){
        const entry = await points.getCreateReason(k);
        entry.should.have.properties(['key','reason','utc']);
        const tdiff = Math.abs(Date.now()-(new Date(entry.utc)));
        tdiff.should.be.below(60*1000);
        entry.key.should.deepEqual(k);
        entry.reason.should.deepEqual("#"+n);
      }
    }));
    dataset10k.abcdefgh = 100;
    dataset10k.bbbbbbbb = 30;
  });
  it('getAllRawPairs,getAllPairs match 10k key dataset', testGetAll(dataset10k));
  it('belowMinRange search returns empty set', async function(){
    const lowPairs = await points.getAllRawPairs(...points.belowMinRange());
    lowPairs.should.deepEqual([]);
  });
  it('aboveMaxRange search returns empty set', async function(){
    const highPairs = await points.getAllRawPairs(...points.aboveMaxRange());
    highPairs.should.deepEqual([]);
  });
  it('delete("badkey","this is wrong") throws invalid key', function(){
      return points.delete("badkey","this is wrong").should.be.rejectedWith(/invalid key/);
  });
  it('delete("bbbbbbbb","testing") returns {key: "bbbbbbbb" deleted: true }', async function(){
      const result = await points.delete("bbbbbbbb", "testing");
      const expected = {
        key: "bbbbbbbb",
        deleted: true
      };
      delete dataset10k.bbbbbbbb;
      result.should.deepEqual(expected);
  });
  it('delete("bbbbbbbb","this is bad") returns {key: "bbbbbbbb" deleted: false }', async function(){
      const result = await points.delete("bbbbbbbb", "this is bad");
      const expected = {
        key: "bbbbbbbb",
        deleted: false
      };
      result.should.deepEqual(expected);
  });
  it('pointomatic.wsum(points.name, {[points.name]: 1,activated: -20}) succeeds with correct count and properties', async function(){
    const count = await points.ioredis.zcard(points.name);
    const destination = points.name;
    const weights = {
      [points.name]: 1,
      activated: -20
    };
    const wsumResult = await points.wsum(destination, weights);
    wsumResult.should.deepEqual({destination, weights, count});
  });
  it('points.get each point values for activated set members should be 20 points lower', async function(){
    await Promise.all(activatedKeys.map(async (k)=>{
      const entry = await points.get(k);
      entry.key.should.deepEqual(k);
      entry.value.should.deepEqual(dataset10k[k]-20);
    }));
  });
  it('points.getAllPairs values should be 20 points lower if and only if activated set member', async function(){
    const expected = Object.assign({}, dataset10k);
    activatedKeys.forEach((k)=>{expected[k] -= 20; });
    const allPairs = await points.getAllPairs();
    const all = Object.fromEntries(allPairs);
    all.should.deepEqual(expected);
  });
  let lowPoints = null;
  it('points.getAllPairs(...points.belowMinRange()) should match expected', async function(){
    const expected = Object.assign({}, dataset10k);
    activatedKeys.forEach((k)=>{expected[k] -= 20; });
    Object.keys(expected).filter((k)=>(expected[k]>=points.min)).forEach((k)=>{ delete expected[k]; });
    const allPairs = await points.getAllPairs(...points.belowMinRange());
    lowPoints = Object.fromEntries(allPairs);
    lowPoints.should.deepEqual(expected);
  });
  it('points.reap("expended") should return the correct deletion count ', async function(){
    const reapCount = await points.reap("expended");
    reapCount.should.deepEqual(Object.keys(lowPoints).length);
  });
  it('points.getAllPairs should return the correct post-reap keys and values', async function(){
    const expected = Object.assign({}, dataset10k);
    activatedKeys.forEach((k)=>{expected[k] -= 20; });
    Object.keys(lowPoints).forEach((k)=>{ delete expected[k]; });
    const allPairs = await points.getAllPairs();
    const all = Object.fromEntries(allPairs);
    all.should.deepEqual(expected);
  });
  if (spec.log){
    it('getParsedLogEntry attempt to access invalid log should return null', async function(){
      const result = await points.getParsedLogEntry('buddyLog',points.encrypt('bbbbbbbb'));
      assert(result===null,"result!==null");
    });
    it('inDeleteLog should yield false for badkey, abcdefgh, true for bbbbbbbb',  async function(){
      const tested = ['badkey', 'bbbbbbbb', 'abcdefgh'];
      const result = await Promise.all(
        tested.map((k)=>(points.inDeleteLog(points.encrypt(k))))
      );
      const expected = [false, true, false];
      result.should.deepEqual(expected);
    });
    it('getDeleteReason should yield expected reasons for keys badkey, abcdefgh, bbbbbbbb', async function(){
      const tested = ['badkey','bbbbbbbb','abcdefgh'];
      const result = await Promise.all(
        tested.map((k)=>(points.getDeleteReason(k)))
      );
      const expected = [
        {key: 'badkey'},
        {key: 'bbbbbbbb', reason: "testing"},
        {key: 'abcdefgh'}
      ];
      delete result[1].utc;
      result.should.deepEqual(expected);
    });
    it('getDeleteReason should yield reason "expended" for each key in lowPoints', async function(){
      await Promise.all(
        Object
        .keys(lowPoints)
        .map(async(k)=>{
          const logEntry = await points.getDeleteReason(k);
          logEntry.key.should.deepEqual(k);
          logEntry.reason.should.deepEqual('expended');
        })
      );
    });
    it('create("bbbbbbbb",99,"again") should throw conflict D because it is an attempt to recreate a deleted key', function(){
      points.create("bbbbbbbb",99,"again").should.be.rejectedWith(/conflict D/);
    });
  } else {
    it('getParsedLogEntry should return null', async function(){
      const result = await points.getParsedLogEntry(points.deleteLog,points.encrypt('bbbbbbbb'));
      assert(result===null,"result!==null");
    });
  }
  it('cleanup: sending FLUSHALL', async function () {
      return await ioredis.flushall();
  });
}

describe('Pointomatic', function(){
  it('should not initialize with incomplete spec', function(){
    function badSpec(){
      // eslint-disable-next-line no-unused-vars
      const badpoints = pointomatic({
          ioredis
      });
    }
    badSpec.should.throw();
  });
  specs.forEach((spec,specnumber)=>{
    describe('test spec '+specnumber, function(){
      commonTests(spec,specnumber);
    });
  });
});
