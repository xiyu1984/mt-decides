const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function tomorrowLocalDate(now = new Date()): string {
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export function validateDate(value: string): string {
  if (!DATE_PATTERN.test(value)) throw new Error("decision date must use YYYY-MM-DD");
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year!, month! - 1, day);
  if (formatLocalDate(parsed) !== value) throw new Error(`invalid decision date: ${value}`);
  return value;
}
