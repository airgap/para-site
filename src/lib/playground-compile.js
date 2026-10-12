import { parse } from "@babel/parser";
import { transpile } from "@lyku/para-transpile";

// These native-parser examples exceed the published standalone compiler.
export const nativeSamples = new Set([
  "pipeline", "promises", "underscoreLambda", "when", "match", "resultMatch",
  "schema", "schemaFrom", "schemaJSON", "boundary", "fusion", "earlyExit",
  "collect", "literalFold",
]);

export function compilePreview(source, nativeSample = false) {
  // This is sample context, not a capability claim about arbitrary edited input.
  const notice = nativeSample
    ? "// The selected example uses features requiring ParaBun.\n"
      + "// Editing it does not establish standalone compiler support.\n"
    : "";
  const caveat = "// Preview only: Para semantics and runtime imports are not verified.\n"
    + "// For the full compiler: parabun build example.pts --outdir dist/\n\n";
  try {
    const output = transpile(source);
    try {
      // Module parsing checks contextual errors as well as token syntax.
      parse(output, { sourceType: "module" });
    } catch (error) {
      return {
        kind: "err", message: "Incomplete transform — invalid JavaScript",
        output: notice + caveat + "// JavaScript module syntax error: "
          + String(error?.message ?? error).replace(/[\r\n]+/g, " ") + "\n\n" + output,
      };
    }
    return {
      kind: "preview", message: "JS syntax checked · Para semantics unverified",
      // A hashbang is valid only at the very start of a module.
      output: output.startsWith("#!")
        ? output.replace(/^(#![^\r\n]*)(\r\n?|\n|$)/, "$1\n" + notice + caveat)
        : notice + caveat + output,
    };
  } catch (error) {
    return { kind: "err", message: "Transform error", output: notice + caveat + String(error?.message ?? error) };
  }
}
