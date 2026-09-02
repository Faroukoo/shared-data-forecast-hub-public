import {
  CONSUMER_V2_TUPLES,
  type ConsumerV2Tuple,
} from "@data-hub/contracts";

export type ErpSnackCategory = ConsumerV2Tuple["category"];
export type ErpSnackLocation = ConsumerV2Tuple["locationKey"];
export type ErpSnackV2Tuple = ConsumerV2Tuple;

export const ERP_SNACK_V2_TUPLES: readonly ErpSnackV2Tuple[] =
  CONSUMER_V2_TUPLES;
