export let banInsanity = <T>(s: T) => {
  if (s === "__prototype__") {
    throw Error("insanity.");
  }
};
