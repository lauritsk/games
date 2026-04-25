import * as v from "valibot";

export type SchemaOutput<TSchema extends v.GenericSchema> = v.InferOutput<TSchema>;

export type PicklistValues = v.PicklistOptions;

export const unknownRecordSchema = v.record(v.string(), v.unknown());
export const finiteNumberSchema = v.pipe(v.number(), v.finite());
export const nonNegativeFiniteNumberSchema = v.pipe(v.number(), v.finite(), v.minValue(0));
export const integerSchema = v.pipe(v.number(), v.integer());
export const nonNegativeIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
export const positiveIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
export const primitiveValueSchema = v.union([v.string(), finiteNumberSchema, v.boolean()]);
export const primitiveRecordSchema = v.record(v.string(), primitiveValueSchema);

export function parseWithSchema<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> | null {
  const result = v.safeParse(schema, value);
  return result.success ? result.output : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return v.is(unknownRecordSchema, value);
}

export function isFiniteNumber(value: unknown): value is number {
  return v.is(finiteNumberSchema, value);
}

export function isInteger(value: unknown): value is number {
  return v.is(integerSchema, value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return v.is(nonNegativeIntegerSchema, value);
}

export function isPositiveInteger(value: unknown): value is number {
  return v.is(positiveIntegerSchema, value);
}

export function integerRangeSchema(min: number, maxExclusive: number) {
  return v.pipe(v.number(), v.integer(), v.minValue(min), v.ltValue(maxExclusive));
}

export function integerBetweenSchema(min: number, max: number) {
  return v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
}

export function isIntegerInRange(value: unknown, length: number): value is number {
  return v.is(integerRangeSchema(0, length), value);
}

export function picklistSchema<const TAllowed extends PicklistValues>(
  allowed: TAllowed,
): v.PicklistSchema<TAllowed, undefined> {
  return v.picklist(allowed);
}

export function parseOneOf<const TAllowed extends PicklistValues>(
  value: unknown,
  allowed: TAllowed,
): TAllowed[number] | null {
  return parseWithSchema(picklistSchema(allowed), value) as TAllowed[number] | null;
}
