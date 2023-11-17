import { Type } from "../Type";

export let coerceType = <X extends Type | string>(schema: any, x: X) => {
  if (x instanceof Type) {
    if (x._schema !== schema) {
      throw Error("Cannot use Type from another schema");
    }
    return x;
  }
  let type = schema[x];
  if (!type) {
    throw Error("Unknown type: " + x);
  }
  return type;
};
