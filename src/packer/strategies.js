// Part ordering strategies.
//
// A greedy packer is only as good as the order it sees the parts in, and no
// single order wins on every project. These three genuinely disagree on the
// seed data, so packMaterial runs all of them and keeps the best result.
//
// Every comparator falls through to the instance label, which makes each
// ordering a total order and therefore reproducible.

function byLabel(a, b) {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

function longestEdge(instance) {
  return Math.max(instance.widthIn, instance.lengthIn);
}

function area(instance) {
  return instance.widthIn * instance.lengthIn;
}

export const STRATEGIES = Object.freeze([
  {
    id: 'longest-edge-desc',
    label: 'Longest edge first',
    order: (instances) => [...instances].sort((a, b) =>
      longestEdge(b) - longestEdge(a) || area(b) - area(a) || byLabel(a, b)),
  },
  {
    id: 'area-desc',
    label: 'Largest area first',
    order: (instances) => [...instances].sort((a, b) =>
      area(b) - area(a) || longestEdge(b) - longestEdge(a) || byLabel(a, b)),
  },
  {
    id: 'width-desc-then-length',
    label: 'Group equal widths',
    // Grouping equal-width parts lets one rip serve several parts, which is
    // why this often wins on cut count even when it loses on waste.
    order: (instances) => [...instances].sort((a, b) =>
      b.widthIn - a.widthIn || b.lengthIn - a.lengthIn || byLabel(a, b)),
  },
]);
