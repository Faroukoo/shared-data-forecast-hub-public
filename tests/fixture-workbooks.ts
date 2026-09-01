import ExcelJS from "exceljs";

interface IpcFixtureOptions {
  cityLabel?: string;
  firstHeader?: string;
  includeMetadata?: boolean;
  periodicity?: string;
  sourceLabel?: string;
  formulaWithoutResult?: boolean;
  includeCasablanca?: boolean;
}

export type HcpOfficialIpcProfile =
  | "ipc-2017-official-g1"
  | "ipc-2017-official-g2";

export type HcpOfficialIppiProfile =
  | "ippi-2018-official-g1"
  | "ippi-2018-official-g2"
  | "ippi-2018-official-g3";

interface HcpOfficialFixtureOptions {
  headerRowOffset?: number;
  duplicateLabel?: boolean;
  unknownLabel?: boolean;
  paddedLabel?: boolean;
  reorderedLabels?: boolean;
  dateHeader?: string;
  appendedBusinessColumn?: boolean;
  periods?: readonly (string | Date)[];
  unexpectedString?: boolean;
  emptyValues?: boolean;
}

const OFFICIAL_IPC_LABELS = {
  "ipc-2017-official-g1": [
    "Produits alimentaires et boissons non alcoolisées",
    "Boissons alcoolisées, tabac et stupéfiants",
    "Articles d'habillement et chaussures",
    "Logement, eau, gaz, électricité et autres combustibles",
    "Meubles, articles de ménage et entretien courant du foyer",
  ],
  "ipc-2017-official-g2": [
    "Transports",
    "Communications",
    "Loisirs et culture",
    "Enseignement",
    "Restaurants et hôtels",
  ],
} as const;

const OFFICIAL_IPPI_LABELS = {
  "ippi-2018-official-g1": [
    "Industries alimentaires",
    "Fabrication de Boissons",
    "Fabrication de produits à base de tabac",
    "Fabrication de textiles",
    "Industrie d'habillement",
    "Industrie de cuir et de la chaussure",
    "Travail du bois et fabrication d'articles en bois",
  ],
  "ippi-2018-official-g2": [
    "Imprimerie et reproduction d’enregistrement",
    "Cokéfaction et raffinage",
    "Industrie chimique",
    "Industrie pharmaceutique",
    "Fabrication de produits en caoutchouc et en plastique",
    "Fabrication d'autres produits minéraux non métalliques",
  ],
  "ippi-2018-official-g3": [
    "Fabrication de produits métalliques",
    "Fabrication de produits informatique",
    "Fabrication d’équipements électriques",
    "Fabrication de machines et équipements n.c.a",
    "Industrie automobile",
    "Fabrication d'autres matériels de transport",
    "fabrication de meubles",
  ],
} as const;

function addMetadata(
  workbook: ExcelJS.Workbook,
  periodicity = "Mensuelle",
  sourceLabel = "Haut-Commissariat au Plan",
): void {
  const sheet = workbook.addWorksheet("Metadata");
  sheet.addRows([
    ["L'indicateur", "Indice des prix à la consommation"],
    ["Définition", "Indice base 100"],
    ["Periodicité", periodicity],
    ["Unité", "Indice"],
    ["Source", sourceLabel],
  ]);
}

async function bytes(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function setOfficialFixtureRows(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  labels: readonly string[],
  periods: readonly (string | Date)[],
  options: HcpOfficialFixtureOptions,
): void {
  const fixtureLabels = [...labels];
  if (options.duplicateLabel && fixtureLabels.length > 1) {
    fixtureLabels[fixtureLabels.length - 1] = fixtureLabels[0] ?? "";
  }
  if (options.unknownLabel) fixtureLabels[0] = "Libellé HCP inventé";
  if (options.paddedLabel) fixtureLabels[0] = ` ${fixtureLabels[0] ?? ""} `;
  if (options.reorderedLabels && fixtureLabels.length > 1) {
    [fixtureLabels[0], fixtureLabels[1]] = [
      fixtureLabels[1] ?? "",
      fixtureLabels[0] ?? "",
    ];
  }

  sheet.getCell(headerRow, 2).value = options.dateHeader ?? "Date";
  fixtureLabels.forEach((label, index) => {
    sheet.getCell(headerRow, index + 3).value = label;
  });
  if (options.appendedBusinessColumn) {
    sheet.getCell(headerRow, fixtureLabels.length + 3).value = "Indice appendu";
  }
  periods.forEach((period, periodIndex) => {
    const row = headerRow + periodIndex + 1;
    sheet.getCell(row, 2).value = period;
    fixtureLabels.forEach((_label, labelIndex) => {
      if (options.emptyValues) return;
      const column = labelIndex + 3;
      sheet.getCell(row, column).value =
        options.unexpectedString && periodIndex === 0 && labelIndex === 0
          ? "indisponible"
          : 100 + periodIndex + (labelIndex + 5) / 10;
    });
    if (options.appendedBusinessColumn) {
      sheet.getCell(row, fixtureLabels.length + 3).value = 999;
    }
  });
}

export async function createHcpOfficialIpcFixture(
  profile: HcpOfficialIpcProfile,
  options: HcpOfficialFixtureOptions = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("IPC");
  const headerRow = 24 + (options.headerRowOffset ?? 0);
  setOfficialFixtureRows(
    sheet,
    headerRow,
    OFFICIAL_IPC_LABELS[profile],
    options.periods ?? ["2026/07", "2026/08"],
    options,
  );
  return bytes(workbook);
}

export async function createHcpOfficialIppiFixture(
  profile: HcpOfficialIppiProfile,
  options: HcpOfficialFixtureOptions = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("IPPI");
  const headerRow = 22 + (options.headerRowOffset ?? 0);
  setOfficialFixtureRows(
    sheet,
    headerRow,
    OFFICIAL_IPPI_LABELS[profile],
    options.periods ?? [
      new Date(Date.UTC(2026, 6, 1)),
      new Date(Date.UTC(2026, 7, 1)),
    ],
    options,
  );
  if (profile === "ippi-2018-official-g2" && !options.emptyValues) {
    sheet.getCell(headerRow + 1, 4).value = "-";
  }
  return bytes(workbook);
}

export async function createIpcFixture(
  options: IpcFixtureOptions = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const data = workbook.addWorksheet("Data");
  data.getCell("A1").value = "Indice des prix à la consommation";
  data.addRow([]);
  data.addRow([]);
  data.addRow([
    options.firstHeader ?? "Villes",
    "Divisions et groupes de produits",
    "2017",
    "Janv-2017",
    "Févr-2017",
  ]);
  const firstRow = data.addRow([
    options.cityLabel ?? "National",
    "(0113) POISSON ET FRUITS DE MER",
    100,
    95.4,
    96.7,
  ]);
  if (options.formulaWithoutResult) {
    firstRow.getCell(4).value = { formula: "90+5.4" };
  }
  if (options.includeCasablanca !== false) {
    data.addRow([
      "Casablanca",
      "(0115) HUILES ET GRAISSES",
      100,
      97.1,
      "-",
    ]);
  }
  if (options.includeMetadata !== false) {
    addMetadata(workbook, options.periodicity, options.sourceLabel);
  }
  return bytes(workbook);
}

export async function createIppFixture(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const data = workbook.addWorksheet("Data");
  data.getCell("A1").value = "Indice des prix à la production";
  data.addRow([]);
  data.addRow([]);
  data.addRow(["Secteurs", "Janv-2019", "Févr-2019"]);
  data.addRow(["Industries Extractives", 100, 100.2]);
  data.addRow(["Total", "-", "-"]);
  addMetadata(workbook);
  return bytes(workbook);
}

export async function createWorkbookWithManyZipEntries(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < 260; index += 1) {
    workbook.addWorksheet(`S${String(index)}`).getCell("A1").value = index;
  }
  return bytes(workbook);
}

export async function createWorkbookWithLargeZipExpansion(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Expanded");
  const compressiblePayload = "x".repeat(32_700);
  for (let row = 1; row <= 1_030; row += 1) {
    sheet.getCell(row, 1).value = `${String(row)}:${compressiblePayload}`;
  }
  return bytes(workbook);
}

export function forgeZipDeclaredUncompressedSizes(
  input: Uint8Array,
  declaredSize = 1,
): Uint8Array {
  const forged = Uint8Array.from(input);
  const buffer = Buffer.from(forged.buffer, forged.byteOffset, forged.byteLength);
  for (let offset = 0; offset <= buffer.length - 4; offset += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50 && offset + 30 <= buffer.length) {
      buffer.writeUInt32LE(declaredSize, offset + 22);
    } else if (signature === 0x02014b50 && offset + 46 <= buffer.length) {
      buffer.writeUInt32LE(declaredSize, offset + 24);
    }
  }
  return forged;
}

export function createCkanFetchFixture(workbookBytes: Uint8Array): typeof fetch {
  return (input) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.pathname.endsWith("/package_show")) {
      return Promise.resolve(new Response(
        JSON.stringify({
          success: true,
          result: {
            id: "0ebb73ec-1f04-4854-b73e-a7868b0b18b0",
            title: "Indice des prix à la consommation (Base 100 2017)",
            metadata_modified: "2025-02-06T12:15:45.127613",
            license_title: "Open Data Commons Open Database License (ODbL)",
            resources: [
              {
                id: "6b44bd34-87ca-479b-b8e6-460f184269fb",
                format: "XLSX",
                url: "https://data.gov.ma/data/example.xlsx",
                size: workbookBytes.byteLength,
                last_modified: "2025-02-06T12:15:45.110238",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    }
    if (url.pathname === "/data/example.xlsx") {
      return Promise.resolve(new Response(workbookBytes, {
        status: 200,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-length": String(workbookBytes.byteLength),
          etag: '"fixture"',
          "last-modified": "Thu, 06 Feb 2025 12:15:45 GMT",
        },
      }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
}
