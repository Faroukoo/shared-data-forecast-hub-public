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
