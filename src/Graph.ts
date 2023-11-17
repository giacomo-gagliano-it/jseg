import { Schema, Type } from "./Type";
import type { Scalar } from "./Scalar";
import { Composite, RelationShip, kind } from "./Composite";
import { getOwn, eachPair, objEmpty, StringMap } from "./util";
import s from "./schema";

export interface Entity {
  lid: string;
  type?: Composite | Scalar | string;
  [k: string]: any;
}

export interface Field extends RelationShip {}

interface Indexes {
  [k: string]: any;
}

class Graph {
  _schema: Schema;
  _options: { log: (...args: any[]) => void; options: any };
  _indexes: Indexes;
  constructor(schema: Schema, options?: any) {
    this._schema = schema;
    const logger = (...args: any[]) => console.error(...args);
    this._options = Object.assign({ log: logger }, options);
    // Construct indexes as map of defining type name -> field name -> obj.
    this._indexes = {} as Indexes;
    const make = new Graph.IndexesMaker(this._indexes, schema, eachPair).make;
    eachPair(this._schema, make);
  }

  _log = (...args: any[]) => this._options.log(...args);

  // Insertion.
  put(entity: Entity) {
    //TODO: begin/commit.
    this._put(entity);
  }

  _put(entity: Entity) {
    const handleNotValid = Graph.handleNotValid;
    if (!Graph.isValidEntity(entity)) return handleNotValid(this._log, entity);
    if (!entity) return null;
    let { lid } = entity;
    if (!lid) return Graph.handleNoLid(this._log, entity);
    // Find or create mutable storage object.
    let obj = this._findByLid(lid);
    const putHandler = new Graph.PutHandler(entity, lid, obj, this);
    if (Graph.isObj(obj)) return putHandler.handleIsObj();
    else return putHandler.handleIsntObj();
  }

  _coerceType(x: any) {
    return this._validate("type", (t: any) => s.coerceType(this._schema, t), x);
  }

  _validate(fieldName: string, f: any, x: any) {
    if (x === null) return null;
    try {
      return f(x);
    } catch (e) {
      this._log("error validating " + fieldName + ": " + e);
      return undefined;
    }
  }

  _putField(obj: any, field: Field, value: any) {
    const fieldPutter = new Graph.FieldPutter(obj, value, field, this);
    if (field.kind === "scalar") fieldPutter.handleScalar();
    else fieldPutter.handleNonScalar();
  }

  // Query.
  get(lid: string, options?: any) {
    let obj = this._findByLid(lid);
    return obj ? this._read(obj, options) : null;
  }

  lookup(
    type: Composite | Scalar | string,
    attribute: string,
    value: any,
    options?: any
  ) {
    const handleNoKeyField = Graph.handleNoKeyField;
    type = this._coerceType(type);
    if (!type) return null;
    let keyField = (type as Composite)._field(attribute);
    if (!keyField)
      return handleNoKeyField((type as Composite)._name, attribute, this._log);
    let obj = this._find(keyField, value);
    if (obj) this._read(obj, options);
    else return null;
  }

  _findByLid(lid: string) {
    let { Entity } = this._schema;
    if (!(Entity instanceof Composite)) throw new Error("");
    let keyField = Entity._fieldDefs["lid"];
    return this._find(keyField, lid);
  }

  _find(keyField: { from: Composite; name: string }, value: any) {
    let { from, name } = keyField;
    let index = this._indexes[from._name][name];
    return index.get(value);
  }

  _read(root: Graph, options: any) {
    let { depth, json } = Object.assign({ depth: 1 }, options);
    depth = depth || -1;
    let marshal = json ? (f: any, x: any) => f(x) : (_: any, x: any) => x;
    let inside: any = {};
    let rec = new Graph.FieldRecorder(depth, inside, marshal).rec;
    return rec(root);
  }

  // Deletion.
  destroy(lid: string) {
    let obj = this._findByLid(lid);
    if (!obj) return;
    this._destroy(obj);
  }

  _destroy(obj: Entity) {
    // Skip objects already destroyed during the cascade.
    if (!this._findByLid(obj.lid)) return;
    let cascade: any[] = [];
    const destroyer = new Graph.EntityDestroyer(obj, cascade, this).destroyer;
    eachPair(obj, destroyer);
    // Preform the delayed cascading destroys.
    const destroy = (other: any) => this._destroy(other);
    cascade.forEach(destroy);
  }

  remove(fromLid: string, relationName: string, toLid: string) {
    let from = this._findByLid(fromLid);
    if (!from) return;
    let relation = from.type._field(relationName);
    if (!relation) return Graph.handleNoRelation(this._log, relationName);
    let to = this._findByLid(toLid);
    if (!to) return;
    return this._remove(from, relation, to);
  }

  _remove(from: Entity, relation: Field, to: Entity) {
    let { kind } = relation;

    const relationRm = new Graph.RelationRemover(from, to, relation, this);

    switch (kind) {
      case "scalar":
        return relationRm.handleRmScalar();

      case "oneToOne":
        relationRm.handleRmOneToOne();
        break;

      case "oneToMany":
        relationRm.handleRmOneToMany();
        break;

      case "manyToOne":
        relationRm.handleRmManyToOne();
        break;

      case "manyToMany":
        relationRm.handleRmManyToMany();
        break;

      default:
        relationRm.handleDefault();
        break;
    }
  }

  _removeOneToMany(from: Entity, relation: Field, to: Entity) {
    let { name, reverse } = relation;
    let set = getOwn(from, name);
    if (!set) return;
    let other = getOwn(set, to.lid);
    delete other[reverse.name];
    delete set[to.lid];
    if (objEmpty(set)) delete from[name];
  }
}

namespace Graph {
  export class HandleKeysMaker {
    constructor(public schema: any, public indexes: any) {}
    handleKeys = (fieldName: string, field: Entity) => {
      // Only index Key fields.
      if (field.type !== this.schema.Key) return;
      let index = new StringMap();
      this.indexes[fieldName] = index;
    };
  }

  export class IndexesMaker {
    constructor(
      public _indexes: any,
      public schema: any,
      public eachPair: <
        T extends Schema,
        K extends string | Extract<keyof T, string>
      >(
        obj: T,
        f: (k: K, v: T[K]) => unknown
      ) => void
    ) {}
    make = (typeName: string, type: Scalar | Composite) => {
      let indexes: Indexes = {};
      this._indexes[typeName] = indexes;

      if (!(type instanceof s.Composite)) {
        return;
      }

      const handleKeys = new Graph.HandleKeysMaker(this.schema, indexes)
        .handleKeys;

      eachPair(type._fieldDefs, handleKeys);
    };
  }

  export class PutHandler {
    constructor(
      public entity: any,
      public lid: any,
      public obj: any,
      public target: Graph
    ) {}

    handleIsObj = (obj: any = this.obj) => {
      // Prevent transmutation of existing object.
      const entity = this.entity;
      if (entity.type) {
        let type = this.target._coerceType(obj.type);
        if (type !== obj.type) {
          this.target._log(
            "put type",
            type,
            "does not match existing:",
            obj.type
          );
          return obj;
        }
      }
    };

    handleIsntObj = (obj: any = this.obj) => {
      const entity = this.entity;
      const lid = this.lid;
      // Create a new typed entity object.
      if (!entity.type) {
        this.target._log("expected type for new entity:", entity);
        return undefined;
      }
      let type = s.coerceType(this.target._schema, entity.type);
      if (!type._field("lid")) {
        this.target._log("not an entity type:", type);
        return undefined;
      }
      // Pre-initialize special fields needed to establish relationships.
      obj = { lid, type };
      let index = this.target._indexes["Entity"]["lid"];
      index.put(lid, obj);

      // Put all non-special fields.
      const putter = new Graph.EntityPutter(
        obj,
        this.target._log.bind(this.target),
        this.target._putField.bind(this.target)
      ).put;

      eachPair(entity, putter);

      return obj;
    };
  }

  class NonScalarHandler {
    constructor(
      public obj: any,
      public target: Graph,
      public name: string,
      public reverse: RelationShip,
      public value: any,
      public field: Field
    ) {}
    handleNonScalarOneToOne = (
      obj: any = this.obj,
      target: Graph = this.target,
      name: string = this.name,
      reverse: RelationShip = this.reverse,
      value: any = this.value
    ) => {
      let other = target._put(value);
      if (typeof other === "undefined") return;
      let prior = getOwn(obj, name);
      if (prior === other) return;
      if (prior) delete prior[reverse.name];
      if (other) obj[name] = other;
      if (other) other[reverse.name] = obj;
      else delete obj[name];
    };
    handleNonScalarOneToMany = (
      obj: any = this.obj,
      target: Graph = this.target,
      name: string = this.name,
      reverse: RelationShip = this.reverse,
      value: any = this.value
    ) => {
      let set = getOwn(obj, name);
      if (!set) set = {};
      obj[name] = set;
      value.forEach(new RelationSetter(target, set, reverse, obj).setValue);
    };
    handleNonScalarManyToOne = (
      obj: any = this.obj,
      target: Graph = this.target,
      name: string = this.name,
      reverse: RelationShip = this.reverse,
      value: any = this.value,
      field: Field = this.field
    ) => {
      let prior = getOwn(obj, name);
      if (prior) target._remove(obj, field, prior);
      let other = target._put(value);
      if (!other) return;
      obj[name] = other;
      let set = other[reverse.name];
      if (!set) set = {};
      other[reverse.name] = set;
      set[obj.lid] = obj;
    };
    handleNonScalarManyToMany = (
      obj: any = this.obj,
      target: Graph = this.target,
      name: string = this.name,
      reverse: RelationShip = this.reverse,
      value: any = this.value
    ) => {
      let fromSet = getOwn(obj, name);
      if (!fromSet) fromSet = {};
      obj[name] = fromSet;
      value.forEach(
        new RelationSetter(target, fromSet, reverse, obj).setRelations
      );
    };
  }

  class RelationSetter {
    constructor(
      public target: Graph,
      public set: any,
      public reverse: RelationShip,
      public obj: any
    ) {}
    setRelations = (x: any) => {
      let other = this.target._put(x);
      if (!other) return;
      let toSet = getOwn(other, this.reverse.name);
      if (!toSet) toSet = {};
      other[this.reverse.name] = toSet;
      this.set[other.lid] = other;
      toSet[this.obj.lid] = this.obj;
    };
    setValue = (x: any) => {
      let other = this.target._put(x);
      if (!other) return;
      let prior = getOwn(other, this.reverse.name);
      if (prior) this.target._remove(other, this.reverse, prior);
      other[this.reverse.name] = this.obj;
      this.set[other.lid] = other;
    };
  }

  export class FieldPutter {
    constructor(
      public obj: any,
      public value: any,
      public field: any,
      public target: Graph
    ) {}
    handleScalar = () => {
      const { value, obj, field } = this;
      const { name, type, from } = field;
      let oldValue = getOwn(obj, name);
      let newValue = this.target._validate(name, type._validate, value);
      if (newValue === null) handleNull(obj, name);
      else if (typeof newValue !== "undefined")
        handleTruthy(obj, name, newValue);
      else return;
      if (type === this.target._schema.Key)
        handleKey(this.target, from, name, oldValue, newValue, obj);
    };

    handleNonScalar = () => {
      const { field, value, obj } = this;
      let { reverse, name, kind } = field;
      const nonscalarHandler = new NonScalarHandler(
        obj,
        this.target,
        name,
        reverse,
        value,
        field
      );

      const handleNonScalarDefault = (log: logger) => {
        log("cannot put field of unexpected kind:", kind);
        return;
      };

      switch (kind) {
        case "oneToOne":
          nonscalarHandler.handleNonScalarOneToOne();
          break;

        case "oneToMany":
          nonscalarHandler.handleNonScalarOneToMany();
          break;

        case "manyToOne":
          nonscalarHandler.handleNonScalarManyToOne();
          break;

        case "manyToMany":
          nonscalarHandler.handleNonScalarManyToMany();
          break;

        default:
          return handleNonScalarDefault(this.target._log);
      }
    };
  }

  export class FieldGetter {
    constructor(
      public obj: any,
      public marshal: (f: any, x: any) => any,
      public rec: (obj: any) => any
    ) {}
    getField = (fieldName: string) => {
      const obj = this.obj;
      const marshal = this.marshal;
      const rec = this.rec;
      const hco = Graph.handleCarOne;
      let value = getOwn(obj, fieldName);
      let field = obj.type._field(fieldName);
      const { cardinality } = field;
      let undef = typeof value === "undefined";
      if (cardinality === "one") return hco(marshal, field, undef, value, rec);
      if (undef) return [];
      let lids = Object.keys(value);
      return lids.map((lid) => rec(value[lid])).sort(field.compare);
    };
  }

  export class FieldRecorder {
    constructor(
      public depth: number,
      public inside: any,
      public marshal: (f: any, x: any) => any
    ) {}
    rec = (obj: any) => {
      const FieldGetter = Graph.FieldGetter;
      let depth = this.depth;
      let inside = this.inside;
      if (depth === 0 || inside[obj.lid]) return { lid: obj.lid };
      inside[obj.lid] = true;
      depth--;
      let getField = new FieldGetter(obj, this.marshal, this.rec).getField;
      let entity: any = {};
      Graph.getterIterator(obj, entity, getField);
      inside[obj.lid] = false;
      depth++;
      return entity;
    };
  }

  export class EntityPutter {
    constructor(public obj: any, public _log: any, public _putField: any) {}
    put = (fieldName: string, value: any) => {
      const obj = this.obj;
      if (fieldName in { lid: true, type: true }) return;
      let field = obj.type._field(fieldName);
      if (!field) return handleNoField(fieldName, obj, this._log);
      this._putField(obj, field, value);
    };
  }

  export class EntityDestroyer {
    constructor(
      public obj: Entity,
      public cascade: any,
      public target: Graph
    ) {}
    destroyer = (fieldName: string, value: any) => {
      const obj = this.obj;
      const cascade = this.cascade;
      if (!(obj.type instanceof Composite)) throw new Error("");
      let field: RelationShip = obj.type._field(fieldName);
      let { from, kind, reverse, destroy } = field;

      // Remove index entries and reverse links.

      switch (kind) {
        case "scalar":
          handleDestroyScalar(field, this.target, from, fieldName, value);
          break;

        case "oneToOne":
          handleDestroyOneToOne(value, reverse);
          break;

        case "oneToMany":
          handleDestroyOneToMany(value, reverse);
          break;

        case "manyToOne":
          handleDestroyManyToOne(value, reverse, obj);
          break;

        case "manyToMany":
          handleDestroyManyToMany(value, reverse, obj);
          break;

        default:
          handleDestroyDefault(this.target._log, kind);
          break;
      }

      // Schedule cascading deletes after reverse references destroyed.
      if (!destroy) return;
      if (field.cardinality === "many") handleCarMany(cascade, value);
      else if (value) cascade.push(value);
    };
  }

  export class RelationRemover {
    constructor(
      public from: Entity,
      public to: Entity,
      public relation: Field,
      public target: Graph
    ) {}

    handleRmScalar = () => {
      throw Error("not implemented"); //XXX
    };

    handleRmOneToOne = () => {
      let value = getOwn(this.from, this.relation.name);
      if (value === this.to) delete this.from[this.relation.name];
      if (value === this.to) delete this.to[this.relation.reverse.name];
    };

    handleRmOneToMany = () =>
      this.target._removeOneToMany(this.from, this.relation, this.to);

    handleRmManyToOne = () =>
      this.target._removeOneToMany(this.to, this.relation.reverse, this.from);

    handleRmManyToMany = () => {
      let fromSet = getOwn(this.from, this.relation.name);
      let toSet = getOwn(this.to, this.relation.reverse.name);
      delete fromSet[this.to.lid];
      delete toSet[this.from.lid];
      if (objEmpty(fromSet)) delete this.from[this.relation.name];
      if (objEmpty(toSet)) delete this.to[this.relation.reverse.name];
    };

    handleDefault = () => {
      this.target._log(
        "cannot remove field of unexpected kind:",
        this.relation.kind
      );
    };
  }

  export interface logger {
    (...args: any[]): void;
  }

  export interface logHandlerUndefined {
    (log: logger, entity: any): undefined;
  }

  export const handleNotValid: logHandlerUndefined = (log, entity) => {
    log("expected entity object:", entity);
    return undefined;
  };

  export const handleNoLid: logHandlerUndefined = (log, entity) => {
    log("missing lid:", entity);
    return undefined;
  };

  export const handleNoKeyField = (
    name: string,
    attribute: string,
    log: logger
  ) => {
    log("Unknown key field: " + name + "." + attribute);
    return null;
  };

  export const handleNoRelation = (log: logger, relationName: string) => {
    log("unknown relation: " + relationName);
    return;
  };

  export const handleCarOne = (
    marshal: (f: any, x: any) => any,
    field: { type: any; kind: kind },
    undef: any,
    value: any,
    rec: any
  ) => {
    if (undef) return null;
    if (field.kind === "scalar") return marshal(field.type._serialize, value);
    return rec(value);
  };

  export const getterIterator = (obj: any, entity: any, cb: any) => {
    for (let fieldName in obj.type._allFields) {
      entity[fieldName] = cb(fieldName);
    }
  };

  export const handleNoField = (fieldName: any, obj: any, log: any) => {
    log("unknown field", JSON.stringify(fieldName), "on", obj.type._name);
    return;
  };

  export const isValidEntity = (entity: any) =>
    !(typeof entity !== "object" || Array.isArray(entity));

  export const isObj = (obj: any) => (obj ? true : false);

  const handleNull = (obj: any, name: string) => delete obj[name];

  const handleTruthy = (obj: any, name: string, newValue: any) =>
    (obj[name] = newValue);

  const delOldValueFromIndex = (oldValue: any, index: any) =>
    index.del(oldValue);

  const putNewValueInIndex = (newValue: any, obj: any, index: any) =>
    index.put(newValue, obj);

  const handleKey = (
    target: Graph,
    from: Entity,
    name: string,
    oldValue: any,
    newValue: any,
    obj: any
  ) => {
    let index = target._indexes[from._name][name];
    if (oldValue) delOldValueFromIndex(oldValue, index);
    if (newValue) putNewValueInIndex(newValue, obj, index);
  };

  // DESTROY

  const handleDestroyScalar = (
    field: RelationShip,
    target: Graph,
    from: Type,
    fieldName: string,
    value: any
  ) => {
    if (field.type === target._schema.Key)
      target._indexes[from._name][fieldName].del(value);
  };

  const handleDestroyOneToOne = (value: any, reverse: RelationShip<kind>) =>
    delete value[reverse.name];

  const handleDestroyOneToMany = (value: any, reverse: RelationShip) => {
    eachPair(value, (lid, other) => {
      delete other[reverse.name];
    });
  };

  const handleDestroyManyToOne = (
    value: any,
    reverse: RelationShip,
    obj: any
  ) => {
    let set = value[reverse.name];
    delete set[obj.lid];
  };

  const handleDestroyManyToMany = (
    value: any,
    reverse: RelationShip,
    obj: any
  ) => {
    eachPair(value, (lid, other) => {
      let set = other[reverse.name];
      delete set[obj.lid];
    });
  };

  const handleDestroyDefault = (log: logger, kind: kind) =>
    log("cannot destroy field of unexpected kind:", kind);

  const handleCarMany = (cascade: any, value: any) => {
    eachPair(value, (lid, other) => {
      cascade.push(other);
    });
  };
}
export default Graph;
// module.exports = Graph;
