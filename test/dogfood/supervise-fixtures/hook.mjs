import { registerHooks } from "node:module";

const adapter = new URL("./adapter.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      ["./queue.ts", "./supervision.ts"].includes(specifier) &&
      context.parentURL?.endsWith("/supervise.mjs")
    )
      return { url: adapter, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
