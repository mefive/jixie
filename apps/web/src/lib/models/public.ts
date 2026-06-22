const keyMap = new Map();

export function generateKey(type: string) {
  if (typeof type !== 'string') {
    throw new Error(`Invalid key type: ${type}`);
  }
  const key = (keyMap.get(type) || 0) + 1;
  keyMap.set(type, key);
  return key;
}
