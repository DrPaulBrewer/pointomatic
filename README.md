# pointomatic

[![Greenkeeper badge](https://badges.greenkeeper.io/DrPaulBrewer/pointomatic.svg)](https://greenkeeper.io/)
[![Build Status](https://travis-ci.org/DrPaulBrewer/pointomatic.svg?branch=master)](https://travis-ci.org/DrPaulBrewer/pointomatic)
[![Coverage Status](https://coveralls.io/repos/github/DrPaulBrewer/pointomatic/badge.svg?branch=master)](https://coveralls.io/github/DrPaulBrewer/pointomatic?branch=master)

Redis-based points/tokens key-key-value manager with create, add, get, delete, reap, weighted sums, logging

## Installation

```
npm i ioredis -S
npm i pointomatic -S
```

## Dependencies

Developers using this library must pass a configured `npm:ioredis` client on initialization.  

`npm:@hapi/joi` is used for initial validation.

## Initialization

Below is a sample configuration to:
* track something called "points"
* use the redis instance running on localhost
* block invalid non-strings or empty-strings when used as keys
* restrict points to be from 0 to 10 million inclusive
* use plain-text keys on the redis database (encrypt/decrypt are identity functions)
* log create/delete events (but not add, there is no general ledger or history)
```
const ioredis = require('ioredis');
const pointomatic = require('pointomatic');
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
const points = pointomatic({
    ioredis,
    name: 'points',
    min: 0,
    max: 10*1000*1000,
    encrypt: (s)=>(s),
    decrypt: (s)=>(s),
    log: true,
    invalid: (s)=>((typeof(s)!=='string') || (s.length===0))
});
```

## Usage

```
await points.create(key, value, optionalReasonForLog);

await points.create("Lisa", 100, "trial offer");
// yields {key: "Lisa", value: 100 }

await points.create("Susan", 20000, "paid plan: conquest!");
// yields {key: "Susan", value: 20000 }

// can not double-create an existing account
await points.create("Susan", 5000, "paid plan: basic");
// throws /conflict E/

await points.create("Undead", -100, "oh no!");
// throws /invalid value below min/

await points.create("Kraken", 1e30, "wow!");
// throws /invalid value above max/

await points.get("Susan")
// yields {key: "Susan", value: 20000 }

await points.add("Susan",100);
// yields {key: "Susan", value: 20100, change: 100 }

await points.add("Susan",-500);
// yields {key: "Susan", value: 19600, change: -500 }

// in race conditions with multiple clients, values outside of allowed range can get temporarily written to redis
// but they are detected and reversed and then an error is returned to one or more clients where addition failed

await points.add("Susan",-1000000);
// throws /invalid value below min/
// database not updated because increment was out of bounds using current value.  Susan still has 19600 points

await points.delete(key, optionalReasonForLog);

await points.delete("Susan","account expired");
// yields { key: "Susan", deleted: true }

await points.getDeleteReason("Susan");
// yields { key: "Susan", utc: "Fri, 17 May 2019 05:00:54 GMT", reason: "account expired"}

// non-existent account deletion does not throw but is noted
await points.delete("Susan", "delete again");
// yields { key: "Susan", deleted: false}

// recreating an account logged as deleted is forbidden
await points.create("Susan", 100);
// throws /conflict D/

await points.wsum(points.name, {[points.name]: 1, "premium": 20});
// give premium members (in redis database set-valued key "premium") 20 points
// uses redis zunionstore
// side effects: ignores min/max and can create accounts that dont exist
// yields { destination: points.name, weights, count }
// count is the number of calculated values

await points.wsum(points.name, {[points.name]: 1, "premium": -20});
// deduct 20 points from premium members

await points.wsum("backup", {[points.name]:1});
// store the points keys/values in another redis sorted set named "backup"

await points.wsum(points.name, {"backup": 1});
// restore from backup, replacing all current keys/values
// doesn't fix/restore logs

await points.reap(optionalReasonForLog);

await points.reap("expended");
// uses redis zremrangebyscore
// when logging is enabled, first fetches list of keys to be deleted and writes delete logs
// yields { count: numberOfDeletedAccounts }


```

## Tests

To test:

First, spin up a redis database on localhost using docker

```
 docker run -v /tmp/data:/data \
    --name "red" \
    -d \
    -p 127.0.0.1:6379:6379 \
    redis redis-server --appendonly yes
```

Warning:  Testing will FLUSHALL and DELETES THE ENTIRE DATABSE on localhost.  

```
npm test
```
### Copyright

Copyright 2019 Paul Brewer, Economic and Financial Technology Consulting LLC

### License

The MIT license

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
