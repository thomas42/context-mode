/**
 * Strip JSONC comments and trailing commas without touching string contents.
 */
export function stripJsonComments(str: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const next = str[i + 1];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && next === "/") {
      i += 1;
      while (i + 1 < str.length && str[i + 1] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < str.length - 1 && !(str[i] === "*" && str[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      continue;
    }

    result += char;
  }

  let output = "";
  inString = false;
  escaped = false;

  for (let i = 0; i < result.length; i++) {
    const char = result[i];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let j = i + 1;
      while (j < result.length && /\s/.test(result[j])) {
        j += 1;
      }
      if (j < result.length && (result[j] === "}" || result[j] === "]")) {
        continue;
      }
    }

    output += char;
  }

  return output;
}
