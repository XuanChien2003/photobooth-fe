// The last photo taken stays last even when its acknowledgement arrives before
// an older photo's. Unknown/legacy shots retain the server/pending order.
export function orderBoothShots(shots, captureOrder = []) {
  if (!captureOrder.length) return shots;
  const ranks = new Map(captureOrder.map((key, index) => [key, index + 1]));
  return [...shots].sort((left, right) =>
    (ranks.get(right.key) || 0) - (ranks.get(left.key) || 0));
}
