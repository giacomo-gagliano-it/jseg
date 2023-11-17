import { inspect } from "util";

import { Graph } from "../src";
import { Schema, Type } from "../src/Type";
import { Composite } from "../src/Composite";
import { Scalar } from "../src/Scalar";

type Generic = Type | Array<any> | object | Scalar | Composite | null;

let classify = <X>(x: X) => {
  if (x === null || x instanceof Type) return "scalar";
  if (Array.isArray(x)) return "array";
  if (typeof x === "object") return "entity";
  return "scalar";
};

let assertEquiv = <X extends Generic, Y extends Generic>(x: X, y: Y | X) => {
  let path: (number | string)[] = [];

  let fail = (msg: string) => {
    throw Error("at ." + (path as string[]).join(".") + " " + msg);
  };

  let rec = (x: X, y: Y | X) => {
    let cx = classify(x);
    let cy = classify(y);
    if (cx !== cy) {
      fail(cx + " !== " + cy);
    }

    switch (cx) {
      case "scalar":
        if (x !== y) fail("" + x + " !== " + y);
        break;

      case "array":
        if ((x as Array<any>).length !== (y as Array<any>).length)
          fail(
            "length " +
              (x as Array<any>).length +
              " but expected " +
              (y as Array<any>).length
          );
        for (let i = 0; i < (x as Array<any>).length; i++) {
          path.push(i);
          rec((x as Array<any>)[i], (y as Array<any>)[i]);
          path.pop();
        }
        break;

      case "entity":
        let ks = Object.keys(x!).sort();
        path.push("*");
        rec(ks as X, Object.keys(y!).sort() as X | Y);
        path.pop();
        ks.forEach((k) => {
          path.push(k);
          rec(x![k as keyof X] as X, (y as Y)![k as keyof Y] as X | Y);
          path.pop();
        });
        break;

      default:
        throw Error("Invalid classification: " + cx);
    }
  };

  rec(x, y);
};

class TestGraph {
  _messages: string[] | null;
  g: Graph;
  constructor(schema: Schema) {
    this._messages = null;
    this.g = new Graph(schema, {
      log: (...args: any[]) => {
        let msg = [...args]
          .map((x) => (typeof x === "string" ? x : inspect(x)))
          .join(" ");
        if (this._messages) {
          this._messages.push(msg);
        } else {
          throw Error("Unexpected message: " + msg);
        }
      },
    });
  }

  check<X, Y>(lid: string, expected: X, options?: Y) {
    options = Object.assign({ depth: 0 }, options);
    assertEquiv(this.g.get(lid, options), expected);
  }

  checkLookup<X extends Generic>(
    type: Composite | Scalar | string,
    attribute: string,
    value: any,
    expected: X,
    options?: any
  ) {
    options = Object.assign({ depth: 0 }, options);
    assertEquiv(this.g.lookup(type, attribute, value, options)!, expected);
  }

  expectMessage(substr: string, f: (...args: any[]) => any) {
    this._messages = [];
    f();
    if (this._messages.length !== 1) {
      throw Error(
        "Expected a 1 message, got " +
          this._messages.length +
          ": " +
          JSON.stringify(this._messages, null, 2)
      );
    }
    if (this._messages[0].indexOf(substr) === -1) {
      throw Error(
        "Expected message containing " +
          JSON.stringify(substr) +
          ", but got: " +
          JSON.stringify(this._messages[0])
      );
    }
    this._messages = null;
  }

  show(lid: string) {
    let entity = this.g.get(lid, { depth: 0, json: true });
    console.log(JSON.stringify(entity, null, 2));
  }

  showLookup<V>(type: Composite, attribute: string, value: V) {
    let entity = this.g.lookup(type, attribute, value, {
      depth: 0,
      json: true,
    });
    console.log(JSON.stringify(entity, null, 2));
  }
}

export { TestGraph };
