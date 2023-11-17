import { Scalar } from "./Scalar";
import { Schema, Type } from "./Type";
import { getOwn } from "./util";

export type kind =
  | "scalar"
  | "oneToMany"
  | "manyToOne"
  | "manyToMany"
  | "oneToOne";
/**
 * Definition structures have form:
 * {kind, from, name, type, cardinality}.
 * kind: One of 'scalar', 'oneToMany', 'manyToOne', or 'manyToMany'.
 * from: Type on which this field was defined.
 * name: Name of field on objects of from type.
 * type: Attribute value's type for scalars, or related objects type.
 * cardinality: 'one' or 'many'. Always 'one' for scalars.
 */
export interface DefinitionStructure<K extends kind = kind> {
  kind: K;
  from: Type;
  name: string;
  type: any;
  cardinality: K extends "scalar" ? "one" : "one" | "many";
}

/**
 * {..., reverse, compare, destroy}.
 * reverse: relationship's counter part on destination type.
 * options: Function for sorting cardinality 'many' arrays on query.
 * destroy: true if destroy should cascade along this relationship.
 */
export interface RelationShip<K extends kind = kind>
  extends DefinitionStructure<K> {
  reverse: RelationShip;
  options: (...args: any[]) => any;
  destroy: boolean;
}

export class Composite<B extends any[] = any[]> extends Type {
  _bases: B;
  _supers: { [k: string]: any };
  _fieldDefs: { [k: string]: any };
  _allFields: {} | null;
  constructor(schema: Schema, name: string, bases: B) {
    super(schema, name);

    this._bases = bases;

    // Compute map of all implemented type names to type objects.
    this._supers = {};
    let include = (type: Composite) => {
      if (this._supers.hasOwnProperty(type._name)) {
        throw Error("Duplicate super " + type._name + " in " + name);
      }
      this._supers[type._name] = type;
      type._bases.forEach((base) => {
        if (!(base instanceof Composite)) {
          throw Error(`${name} extends non-Composite: ${type._name}`);
        }
        include(base);
      });
    };
    include(this);

    // Maps field names defined directly on this type to definition structures.
    //
    // Definition structures have form:
    // {kind, from, name, type, cardinality}.
    //   kind: One of 'scalar', 'oneToMany', 'manyToOne', or 'manyToMany'.
    //   from: Type on which this field was defined.
    //   name: Name of field on objects of from type.
    //   type: Attribute value's type for scalars, or related objects type.
    //   cardinality: 'one' or 'many'. Always 'one' for scalars.
    //
    // Relationships have additional fields:
    // {..., reverse, compare, destroy}.
    //   reverse: relationship's counter part on destination type.
    //   options: Function for sorting cardinality 'many' arrays on query.
    //   destroy: true if destroy should cascade along this relationship.
    //
    // Populated during type system finalization.
    this._fieldDefs = {};

    // Maps a union of field names from this and all super types.
    // Initialized after all types have their _fieldDefs populated.
    this._allFields = null;
  }

  _defField<F extends { name: string }>(field: F) {
    let { name } = field;
    Type.banInsanity(name);
    this._fieldDefs[name] = field;
  }

  _field(name: string) {
    return getOwn(this._allFields as any, name);
  }
}

export namespace Composite {
  export class TypeFieldDefiner<A extends {}, C extends Composite = Composite> {
    constructor(
      public attributeTypes: A,
      public typeName: string,
      public type: C
    ) {}
    defineTypeField = (attrName: string) => {
      if (!(this.attributeTypes[attrName as keyof A] instanceof Scalar)) {
        throw Error(`Expected scalar for ${this.typeName}.${attrName}`);
      }
      if (this.type._fieldDefs.hasOwnProperty(attrName)) {
        throw Error(
          this.type._name + "." + attrName + " conflicts with builtin field"
        );
      }
      this.type._defField({
        kind: "scalar",
        cardinality: "one",
        from: this.type,
        name: attrName,
        type: this.attributeTypes[attrName as keyof A],
      });
    };
  }

  export class TypeBuilder<T extends { [k: string]: T }> {
    _getType: (name: string) => Composite | Scalar;
    constructor(
      public attributes: T,
      getType: (name: string) => Composite | Scalar,
      public Ctor: typeof TypeFieldDefiner = Composite.TypeFieldDefiner
    ) {
      this._getType = getType;
    }
    buildType = (typeName: string) => {
      let attributeTypes: T = this.attributes[typeName as keyof T] as T;
      let type = this._getType(typeName);
      console.log(Object.keys(type));
      if (!(type instanceof Composite)) throw new Error("not a Composite");

      const defineTypeField = new this.Ctor(attributeTypes, typeName, type)
        .defineTypeField;

      Object.keys(attributeTypes).forEach(defineTypeField);
    };
  }
}
