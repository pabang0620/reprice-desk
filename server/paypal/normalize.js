export function regularCycle(cycles = []) {
  return cycles.find((c) => c.tenureType === 'REGULAR') || cycles[0]
}
