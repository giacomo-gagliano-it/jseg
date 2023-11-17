import type { Composite } from "./Composite";
import type { Scalar } from "./Scalar";
import { banInsanity as b } from "./utils/banInstanity";

export interface Schema {
  [k: string]: Composite | Scalar;
}

export class Type {
  _schema;
  _name;
  constructor(schema: Schema, name: string) {
    Type.banInsanity(name);
    this._schema = schema;
    this._name = name;
  }

  name() {
    return this._name;
  }
}
export namespace Type {
  export const banInsanity = b;
}
