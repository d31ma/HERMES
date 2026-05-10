import { r403 } from "@/services/respond.js";
import { createDb, Collections } from "@/repositories/index.js";
import { isTestRoutesEnabled } from "@/services/security.js";
/**
 * DELETE /test/reset
 * @param {object} params
 * @returns {Promise<Record<string, unknown>>}
 */
export async function handler() {
  if (!isTestRoutesEnabled())
    return r403("Only available in test mode");
  const fylo = await createDb();
  for (const collection of Object.values(Collections)) {
    const docs = {};
    for await (const doc of fylo.findDocs(collection, { $ops: [] }).collect()) {
      Object.assign(docs, doc);
    }
    for (const docId of Object.keys(docs)) {
      await fylo.delDoc(collection, docId);
    }
  }
  return { reset: true };
}
