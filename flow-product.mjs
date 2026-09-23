// Exact established aliases only. Do not infer a SKU from substrings, titles,
// activity names, mixed products, or missing classifications.
export function flowProductKey(value) {
 const text=String(value??'').trim();
 return ['WIS隐形水润面膜','隐形水润面膜','水润面膜'].includes(text)?'隐形水润面膜':text;
}
export function sameFlowProduct(left,right) {
 const a=flowProductKey(left),b=flowProductKey(right);
 return Boolean(a&&b&&a===b);
}
