import { createVibeBossEnvironmentAtoms } from "@t3tools/client-runtime/state/vibeboss";

import { connectionAtomRuntime } from "../connection/runtime";

export const vibeBossEnvironment = createVibeBossEnvironmentAtoms(connectionAtomRuntime);
