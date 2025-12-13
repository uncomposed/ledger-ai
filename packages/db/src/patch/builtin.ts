import { registerPatchHandler } from "./registry.js";
import { inventoryImportTextV1 } from "./handlers/inventoryImportTextV1.js";

registerPatchHandler(inventoryImportTextV1);

