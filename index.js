const Joi = require('@hapi/joi');

const schema = Joi.object().keys({
  ioredis: Joi.object().required().unknown(),
  name: Joi.string().required(),
  min: Joi.number().required(),
  max: Joi.number().required(),
  encrypt: Joi.func().required(),
  decrypt: Joi.func().required(),
  invalid: Joi.func().required(),
  log: Joi.boolean().required()
});

class Pointomatic {
  constructor(options){
    Object.assign(this,options);
    if (this.log){
      this.createLog = this.name+"CreateLog";
      this.deleteLog = this.name+"DeleteLog";
    }
  }

  assertKey(k, method){
    if (this.invalid(k))
      throw new Error("Pointomatic "+method+" error: invalid key");
  }

  assertRange(v, method){
    if ((typeof(v)!=='number') || (isNaN(v)))
      throw new Error("Pointomatic "+method+" error: invalid value, expected a number");
    if(v > this.max){
      throw new Error("Pointomatic "+method+" error: invalid value above max");
    }
    if(v < this.min){
      throw new Error("Pointomatic "+method+" error: invalid value below min");
    }
  }

  parseNumber(raw, method){
    if (raw===null)
      throw new Error("Pointomatic "+method+" error: non-existent key");
    const value = parseFloat(raw);
    if (isNaN(value))
      throw new Error("Pointomatic "+method+" error: non-numeric value");
    return value;
  }

  async create(key, rawvalue, reason){
    this.assertKey(key, "create");
    const value = this.parseNumber(rawvalue, "create");
    this.assertRange(value, "create");
    const encryptedKey = this.encrypt(key);
    const previouslyDeleted = await this.inDeleteLog(encryptedKey);
    if (previouslyDeleted)
      throw new Error("Pointomatic create error: conflict D");
    const result = await this.ioredis.zadd(this.name,'NX',value,encryptedKey);
    if (result===1) {
      await this.insertIntoLog(this.createLog, encryptedKey, reason);
      return { key, value };
    }
    throw new Error("Pointomatic create error: conflict E");
  }

  async insertIntoLog(logkey, encryptedKey, reason){
    if ((!this.log) || (!(logkey.startsWith(this.name)))) return false;
    const logEntry = new Date().toUTCString()+'---'+reason;
    const inserted = await this.ioredis.hset(logkey, encryptedKey, logEntry);
    return +inserted;
  }

  async inDeleteLog(encryptedKey){
    if (!this.log) return false;
    const found = await this.ioredis.hexists(this.deleteLog, encryptedKey);
    return (found===1);
  }

  async getParsedLogEntry(logkey, encryptedKey){
    if ((!this.log) || (!(logkey.startsWith(this.name)))) return null;
    const logEntry = await this.ioredis.hget(logkey,encryptedKey);
    if (logEntry===null) return null;
    const [utc,reason] = logEntry.split("---");
    return {utc, reason};
  }

  async getCreateReason(key){
    return Object.assign({key}, await this.getParsedLogEntry(this.createLog, this.encrypt(key)));
  }

  async getDeleteReason(key){
    return Object.assign({key}, await this.getParsedLogEntry(this.deleteLog, this.encrypt(key)));
  }

  async get(key){
    this.assertKey(key, "get");
    const rawValue = await this.ioredis.zscore(this.name, this.encrypt(key));
    const value = this.parseNumber(rawValue, "get");
    return {key, value};
  }

  async add(key, rawchange){
    this.assertKey(key,"add");
    const change = parseFloat(rawchange);
    if (isNaN(change))
      throw new Error("Pointomatic add error: non-numeric change");
    const current = await this.get(key);
    const expected = current.value+change;
    this.assertRange(expected, "add");
    const rawValue = await this.ioredis.zincrby(this.name,change,this.encrypt(key));
    const value = this.parseNumber(rawValue,"add");
    /* istanbul ignore next */
    try {
      this.assertRange(value, "add");
    } catch(e){
      await this.ioredis.zincrby(this.name,-change,this.encrypt(key));
      throw e;
    }
    return {key, value, change};
  }

  async getAllRawPairs(low, high){
    let raw;
    if ((low===undefined) && (high===undefined)){
      raw = await this.ioredis.zrange(this.name,0,-1,"WITHSCORES");
    } else {
      raw = await this.ioredis.zrangebyscore(this.name,low,high,"WITHSCORES");
    }
    const l = raw.length;
    const pairs = [];
    let i = 0;
    while(i<l){
      pairs.push([raw[i],parseFloat(raw[i+1])]);
      i += 2;
    }
    return pairs;
  }

  async getAllPairs(low,high){
    const pairs = await this.getAllRawPairs(low,high);
    const l = pairs.length;
    let i = 0;
    for(i=0;i<l;++i)
      pairs[i][0] = this.decrypt(pairs[i][0]);
    return pairs;
  }

  belowMinRange(){
    return ['-inf','('+this.min];
  }

  aboveMaxRange(){
    return ['('+this.max,'+inf'];
  }

  async delete(key, reason){
    this.assertKey(key,"delete");
    const encryptedKey = this.encrypt(key);
    const count = await this.ioredis.zrem(this.name,encryptedKey);
    if (count===1){
      await this.insertIntoLog(this.deleteLog, encryptedKey, reason);
    }
    return { key, deleted: (count===1) };
  }

  async wsum(destination, weights){
    const keys = Object.keys(weights);
    const scales = Object.values(weights);
    const count = await this.ioredis.zunionstore(destination, keys.length, keys, "weights", scales);
    return {destination, weights, count};
  }

  async reap(reason){
    const zargs = [this.name].concat(...this.belowMinRange());
    let lowEncryptedKeys = [];
    if (this.log){
      lowEncryptedKeys = await this.ioredis.zrangebyscore(...zargs);
      await Promise.all(
        lowEncryptedKeys.map((k)=>(this.insertIntoLog(this.deleteLog,k,reason)))
      );
    }
    const reapCount = await this.ioredis.zremrangebyscore(...zargs);
    return reapCount;
  }

}

module.exports = function (options) {
  const { error, value } = Joi.validate(options,schema);
  if (error!==null) throw new Error("Pointomatic initialization error: "+error);
  return new Pointomatic(value);
};
