/**
 * Safe number formatting utilities
 * 
 * Prevents "Cannot read properties of undefined (reading 'toFixed')" errors
 * by handling undefined, null, NaN, and non-numeric values gracefully.
 */

/**
 * Safely formats a number to a fixed number of decimal places.
 * 
 * @param value - The value to format (can be number, null, undefined, or NaN)
 * @param digits - Number of decimal places (default: 1)
 * @returns Formatted string with the specified decimal places
 * 
 * @example
 * toFixedSafe(123.456, 2)  // "123.46"
 * toFixedSafe(undefined, 1) // "0.0"
 * toFixedSafe(NaN, 0)       // "0"
 * toFixedSafe(null, 2)      // "0.00"
 */
export function toFixedSafe(
  value: number | null | undefined,
  digits: number = 1
): string {
  if (Number.isFinite(value as number)) {
    return (value as number).toFixed(digits);
  }
  return (0).toFixed(digits);
}

