const MONTHS = new Map<string, number>([
  ["Janv", 1],
  ["Févr", 2],
  ["Mars", 3],
  ["Avr", 4],
  ["Mai", 5],
  ["Juin", 6],
  ["Juill", 7],
  ["Août", 8],
  ["Sept", 9],
  ["Oct", 10],
  ["Nov", 11],
  ["Déc", 12],
]);

export interface HcpMonthPeriod {
  periodStart: string;
  periodEnd: string;
}

export function parseHcpMonthHeader(header: string): HcpMonthPeriod | null {
  const normalized = header.trim().normalize("NFC");
  if (/^\d{4}$/.test(normalized)) return null;
  const match = /^(Janv|Févr|Mars|Avr|Mai|Juin|Juill|Août|Sept|Oct|Nov|Déc)-(\d{4})$/.exec(
    normalized,
  );
  if (!match) return null;
  const month = MONTHS.get(match[1] ?? "");
  const year = Number(match[2]);
  if (!month || year < 1900 || year > 2200) return null;
  const monthText = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStart: `${String(year)}-${monthText}-01`,
    periodEnd: `${String(year)}-${monthText}-${String(lastDay).padStart(2, "0")}`,
  };
}
