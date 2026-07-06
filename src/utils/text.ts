export function decodeHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, "\"")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtml(input?: string): string {
  return decodeHtml(input || "");
}

export function titleSizeClass(title: string): string {
  const length = title.length;
  if (length <= 55) return "title-large";
  if (length <= 95) return "title-medium";
  if (length <= 135) return "title-small";
  return "title-extra-small";
}

export function shouldShowExcerpt(title: string, excerpt?: string): boolean {
  return Boolean(excerpt?.trim()) && title.length <= 95;
}
