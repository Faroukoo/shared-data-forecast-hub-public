import {
  ERP_SNACK_LOCATIONS,
  ERP_SNACK_SERIES,
} from "./erp-snack-profile.js";

export type ErpSnackCategory = (typeof ERP_SNACK_SERIES)[number]["category"];
export type ErpSnackLocation = (typeof ERP_SNACK_LOCATIONS)[number];

export type ErpSnackV2Tuple = {
  category: ErpSnackCategory;
  locationKey: ErpSnackLocation;
  seriesKey: string;
  sourceId:
    | "hcp-ipc-2017-monthly"
    | "hcp-ipc-2017-official-g1-monthly";
  contextRole:
    | "fresh_national_context"
    | "historical_detailed_context";
  granularity: "division" | "group_of_products";
};

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const ERP_SNACK_V2_TUPLES: readonly ErpSnackV2Tuple[] = Object.freeze(
  ERP_SNACK_SERIES.flatMap((series) =>
    ERP_SNACK_LOCATIONS.map((locationKey): ErpSnackV2Tuple => {
      const freshNational =
        series.category === "food_overall" && locationKey === "ma";
      return Object.freeze({
        category: series.category,
        locationKey,
        seriesKey: series.seriesKey,
        sourceId: freshNational
          ? "hcp-ipc-2017-official-g1-monthly"
          : "hcp-ipc-2017-monthly",
        contextRole: freshNational
          ? "fresh_national_context"
          : "historical_detailed_context",
        granularity:
          series.category === "food_overall"
            ? "division"
            : "group_of_products",
      });
    }),
  ).sort(
    (left, right) =>
      compareCodeUnits(left.seriesKey, right.seriesKey) ||
      compareCodeUnits(left.locationKey, right.locationKey),
  ),
);
