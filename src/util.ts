import { Schema } from "./Type";

let getOwn = <T extends object, K extends keyof T | string>(obj: T, key: K) =>
  obj.hasOwnProperty(key) ? obj[key as keyof T] : undefined;

let eachPair = <T extends Schema, K extends Extract<keyof T, string> | string>(
  obj: T,
  f: (k: K, v: T[K]) => unknown
) => {
  for (let key in obj) {
    f(key as K, obj[key as K]);
  }
};

let objEmpty = <T>(obj: T) => {
  for (let key in obj) {
    return false;
  }
  return true;
};

// A string map safe for inherited properties, including __prototype__.
class StringMap<
  T extends { [k: string]: unknown },
  K extends Extract<keyof T, string>
> {
  _obj: T;
  constructor() {
    this._obj = {} as T;
  }

  get(key: K) {
    return getOwn(this._obj, key + "$");
  }

  put(key: K, value: unknown) {
    this._obj[(key + "$") as K] = value as T[K];
  }

  del(key: K) {
    delete this._obj[key + "$"];
  }
}

export { getOwn, objEmpty, eachPair, StringMap };
