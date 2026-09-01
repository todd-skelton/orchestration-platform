export function runFirstConsumerScaffoldCheck(): Promise<
  Readonly<{ extensions: number; outcome: "PASS" }>
>;
export function runFirstConsumerFootprintCollisionCheck(): Promise<
  Readonly<{ paths: readonly string[]; outcome: "PASS" }>
>;
export function runFirstConsumerPackageBoundaryCheck(): Promise<Readonly<{ outcome: "PASS" }>>;
