import jseg from "../src";
import { TestGraph } from "./util";

let [b, t] = jseg.newSchema();

b.entity("Thing");

b.finalize({
  attributes: {
    Thing: {
      time: t.Time,
    },
  },

  relationships: [],
});

let tg = new TestGraph(t);

let time = new Date(1463375134532);

tg.g.put({
  type: "Thing",
  lid: "x",
  time,
});

tg.check("x", {
  type: t.Thing,
  lid: "x",
  time,
});

tg.check(
  "x",
  {
    lid: "x",
    type: "Thing",
    time: "2016-05-16T05:05:34.532Z",
  },
  { json: true }
);
