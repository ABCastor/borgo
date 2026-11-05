// The product's name and the mark it wears. To wear another mark, change MARK_ID to "posto", "campanile" or
// "torri" (./marks.ts): the header, the favicon and the app icon all follow from this line.
import { MARKS, type Mark, type MarkId } from "./marks.ts";

export const PRODUCT_NAME = "Borgo";

export const MARK_ID: MarkId = "posto";

export const MARK: Mark = MARKS[MARK_ID];
