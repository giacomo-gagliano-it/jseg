export let compareLids = <T extends { lid: string }>(x: T, y: T) => {
  if (x.lid < y.lid) return -1;
  if (x.lid > y.lid) return 1;
  return 0;
};
