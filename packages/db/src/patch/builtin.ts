import { registerPatchHandler } from "./registry.js";
import { inventoryImportTextV1 } from "./handlers/inventoryImportTextV1.js";
import { inventoryDeltaV1 } from "./handlers/inventoryDeltaV1.js";
import { mealPlanV1 } from "./handlers/mealPlanV1.js";

registerPatchHandler(inventoryImportTextV1);
registerPatchHandler(inventoryDeltaV1);
registerPatchHandler(mealPlanV1);
