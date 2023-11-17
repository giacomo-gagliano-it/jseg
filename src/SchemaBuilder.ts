import { Composite } from "./Composite";
import { Scalar, ScalarOptions } from "./Scalar";
import { Schema, Type } from "./Type";
import { coerceType } from "./utils/coerceType";
import { compareLids } from "./utils/compareLids";

export class SchemaBuilder {
  _types: Schema | null;

  _getType(name: keyof Schema) {
    if (!this._types) throw new Error("no _types");
    let type = this._types[name];
    if (!type) throw Error("Unknown type: " + name);
    return type;
  }

  _type(type: Composite | Scalar) {
    if ((this._types as Schema).hasOwnProperty(type._name))
      throw Error("Redefinition of type: " + type._name);
    if (!this._types) throw new Error("no _types");
    this._types[type._name] = type;
    return type;
  }

  _defineScalarTypes(primitive: (name: string, tag: string) => void) {
    primitive("Text", "string");

    primitive("Bool", "boolean");

    primitive("Num", "number");

    this.scalar("Scalar", {
      validate: SchemaBuilder.defaultScalar,
    });

    this.scalar("Key", {
      validate: SchemaBuilder.defaultKeyValidator,
    });

    this.scalar("Type", {
      validate: new SchemaBuilder.DefaultTypevalidator(this._types).validator,
      serialize: SchemaBuilder.defaultTypeSerializer,
    });

    this.scalar("Time", {
      validate: SchemaBuilder.defaultTimeValidator,
      serialize: SchemaBuilder.defaultTimeSerializer,
    });
  }

  _preventAdditionalOperations() {
    this._types = null;
  }
  constructor() {
    this._types = {};

    // Define standard scalar types.
    this._defineScalarTypes(
      new SchemaBuilder.PrimivesDefiner(this.scalar.bind(this)).primitive
    );

    // Declare the only special composite type.
    this.trait("Entity");
  }

  scalar(name: string, options: ScalarOptions) {
    if (!this._types) throw new Error("no _types");
    return this._type(new Scalar(this._types, name, options));
  }

  trait<B extends any[]>(name: string, ...bases: B) {
    if (!this._types) throw new Error("no _types");
    return this._type(new Composite(this._types, name, bases));
  }

  entity<B extends any[]>(name: string, ...bases: B) {
    if (!this._types) throw new Error("no _types");
    bases = [this._types.Entity].concat(bases) as B;
    return this._type(new Composite(this._types, name, bases));
  }

  finalize<T extends {}, R extends any[]>({
    attributes,
    relationships,
  }: {
    attributes: T;
    relationships: R;
  }) {
    // Add special attributes to Entity.
    let Entity = (this._types as Schema).Entity as Composite;
    Entity._defField({
      kind: "scalar",
      cardinality: "one",
      from: Entity,
      name: "lid",
      type: (this._types as Schema).Key,
    });
    Entity._defField({
      kind: "scalar",
      cardinality: "one",
      from: Entity,
      name: "type",
      type: (this._types as Schema).Type,
    });

    // Decorate types with attributes.
    Object.keys(attributes).forEach(
      new Composite.TypeBuilder(
        attributes as any,
        this._getType.bind(this) as any
      ).buildType
    );

    // Decorate types with relationships.
    relationships.forEach(([left, right]) => {
      let [typeL, cardL, nameL, optsL] = left;
      let [typeR, cardR, nameR, optsR] = right;
      let defL = SchemaBuilder.addRelation(
        typeL,
        cardL,
        cardR,
        nameL,
        typeR,
        optsL
      );
      let defR = SchemaBuilder.addRelation(
        typeR,
        cardR,
        cardL,
        nameR,
        typeL,
        optsR
      );
      defL.reverse = defR;
      defR.reverse = defL;
    });
    // Build field set indexes recursively bottom-up.

    // Run field indexing on all types.
    Object.keys(this._types as Schema).forEach((typeName) => {
      let type = (this._types as Schema)[typeName];
      SchemaBuilder.indexFields(type as Composite);
    });

    // Prevent additional operations.
    this._preventAdditionalOperations();
  }
}

export namespace SchemaBuilder {
  export type relationKindsKeys = keyof typeof relationKinds;
  export const relationKinds = {
    one: {
      one: "oneToOne",
      many: "oneToMany",
    },
    many: {
      one: "manyToOne",
      many: "manyToMany",
    },
  };
}
export namespace SchemaBuilder {
  export let addRelation = (
    fromType: Composite,
    fromCard: string,
    toCard: string,
    name: string,
    toType: string,
    options: ScalarOptions
  ) => {
    if (fromType._fieldDefs.hasOwnProperty(name)) {
      throw Error(`Relation redefines field: ${fromType}.${name}`);
    }
    let { compare, destroy } = Object.assign(
      {
        compare: compareLids,
        destroy: false,
      },
      options
    );
    let def: {
      kind: string;
      cardinality: string;
      from: Composite<any[]>;
      name: string;
      type: string;
      reverse: null | {
        kind: string;
        cardinality: string;
        from: Composite<any[]>;
        name: string;
        type: string;
        reverse: null | any;
        compare: <
          T extends {
            lid: string;
          }
        >(
          x: T,
          y: T
        ) => 1 | -1 | 0;
        destroy: boolean;
      };
      compare: <
        T extends {
          lid: string;
        }
      >(
        x: T,
        y: T
      ) => 1 | -1 | 0;
      destroy: boolean;
    } = {
      kind: SchemaBuilder.relationKinds[
        toCard as SchemaBuilder.relationKindsKeys
      ][fromCard as SchemaBuilder.relationKindsKeys],
      cardinality: fromCard,
      from: fromType,
      name,
      type: toType,
      reverse: null, // Knot tied below.
      compare,
      destroy,
    };
    fromType._defField(def);
    return def;
  };

  export class FieldSetIndexesBuilder {
    constructor(public baseType: any, public type: any) {}
    build = (fieldName: string) => {
      let field = this.baseType._allFields[fieldName];

      // Check for conflicts.
      if ((this.type._allFields as {}).hasOwnProperty(fieldName)) {
        let existing = (this.type._allFields as any)[fieldName];
        throw Error(
          `Field ${fieldName} conflicts between ` +
            `${existing.from._name} and ${field.from._name}`
        );
      }

      (this.type._allFields as any)[fieldName] = field;
    };
  }

  export let indexFields = (type: Composite) => {
    if (type._allFields !== null) {
      // Already visited this type.
      return type._allFields;
    }
    type._allFields = Object.assign({}, type._fieldDefs);
    type._bases.forEach(new PreFieldSetIndexesBuilder(type).prebuild);
    return type._allFields;
  };

  export class PreFieldSetIndexesBuilder {
    constructor(public type: any) {}
    prebuild = (baseType: any) => {
      Object.keys(indexFields(baseType)).forEach(
        new SchemaBuilder.FieldSetIndexesBuilder(baseType, this.type).build
      );
    };
  }

  export class PrimivesDefiner {
    constructor(
      public scalar: (
        name: string,
        options: {
          validate?: ((x: any) => any) | undefined;
          serialize?: ((x: any) => any) | undefined;
        }
      ) => Type
    ) {}
    primitive = (name: string, tag: string) => {
      this.scalar(name, {
        validate: (x) => {
          if (typeof x !== tag) {
            throw Error("Expected " + tag);
          }
          return x;
        },
      });
    };
  }

  export const defaultScalar = (x: any) => x;

  export const defaultKeyValidator = (x: string) => {
    if (typeof x === "string") {
      (x as string) = x.trim();
      if (x !== "") {
        return x;
      }
    }
    throw Error("expected non-empty string");
  };

  export class DefaultTypevalidator {
    constructor(public _types: Schema | null) {}
    validator = (x: Type) => coerceType(this._types, x);
  }

  export const defaultTypeSerializer = (x: Type) => x._name;

  export const defaultTimeValidator = (x: number) => new Date(x);

  export const defaultTimeSerializer = (x: Date) => x.toISOString();
}
