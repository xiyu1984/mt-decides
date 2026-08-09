const TEMPLATE_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function renderPromptTemplate(template: string, values: Record<string, string>): string {
  const used = new Set<string>();
  const rendered = template.replace(TEMPLATE_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`unknown prompt placeholder: ${name}`);
    used.add(name);
    return value;
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`unused prompt placeholders: ${unused.join(", ")}`);
  return rendered;
}
