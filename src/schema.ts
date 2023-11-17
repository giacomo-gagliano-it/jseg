import { Schema, Type } from "./Type";
import { Scalar } from "./Scalar";
import { Composite } from "./Composite";
import { coerceType } from "./utils/coerceType";
import { SchemaBuilder as SB, SchemaBuilder } from "./SchemaBuilder";

let newSchema = (): [SchemaBuilder, Schema] => {
  let b = new SB();
  return [b, b._types!];
};

export default { coerceType, Type, Scalar, Composite, newSchema };
