export function readHttpUrl(value: string | undefined, optionName = "--url"): URL {
  if (!value?.trim()) throw new Error(`${optionName} is required`);
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${optionName} must use http or https`);
  }
  return url;
}
