function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "null" || value === "~") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Minimal YAML parser for OpenAPI JSON/YAML import (no external dependency). */
export function parseMinimalYaml(content: string): Record<string, unknown> {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [
    { indent: -1, value: root },
  ];
  let pendingKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trim() === "---") {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1]!.value;
    const trimmed = line.trim();

    if (trimmed.startsWith("- ")) {
      const itemValue = trimmed.slice(2);
      let arrayTarget: unknown[];
      if (Array.isArray(current)) {
        arrayTarget = current;
      } else if (pendingKey && typeof current === "object" && !Array.isArray(current)) {
        arrayTarget = [];
        current[pendingKey] = arrayTarget;
        pendingKey = null;
      } else {
        continue;
      }
      if (itemValue.includes(":")) {
        const obj: Record<string, unknown> = {};
        const [key, ...rest] = itemValue.split(":");
        obj[key.trim()] = parseScalar(rest.join(":"));
        arrayTarget.push(obj);
        stack.push({ indent, value: obj });
      } else {
        arrayTarget.push(parseScalar(itemValue));
      }
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rest = trimmed.slice(separatorIndex + 1).trim();
    pendingKey = key;

    if (typeof current !== "object" || Array.isArray(current)) {
      continue;
    }

    if (!rest) {
      const child: Record<string, unknown> = {};
      current[key] = child;
      stack.push({ indent, value: child });
      continue;
    }

    current[key] = parseScalar(rest);
  }

  return root;
}
