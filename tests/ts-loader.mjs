import { access } from "node:fs/promises";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
    if (!isRelative || hasExtension || error?.code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }

    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    await access(candidate);
    return {
      shortCircuit: true,
      url: candidate.href,
    };
  }
}
