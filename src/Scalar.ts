import { Schema, Type } from "./Type";

export interface Validator {
  (x: any): any;
}

export interface Serializer {
  (x: any): any;
}

export interface ScalarOptions {
  validate?: Validator;
  serialize?: Serializer;
}

export class Scalar extends Type {
  _validate: Validator;
  _serialize: Serializer;
  constructor(
    schema: Schema,
    name: string,
    { validate, serialize }: ScalarOptions
  ) {
    super(schema, name);
    this._validate = validate || (<T>(x: T) => x);
    this._serialize = serialize || (<T>(x: T) => x);
  }
}
