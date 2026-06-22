export function uuid() {
  const chars = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.split('');
  for (let i = 0, len = chars.length; i < len; i += 1) {
    switch (chars[i]) {
      case 'x':
        chars[i] = Math.floor(Math.random() * 16).toString(16);
        break;
      case 'y':
        chars[i] = (Math.floor(Math.random() * 4) + 8).toString(16);
        break;
      default:
    }
  }
  return chars.join('');
}

export function decodeBase64(base64: string) {
  const binString = atob(base64);
  const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
  return btoa(binString);
}

export function pickFields<T extends object>(
  payload: T,
  fieldNames?: string[],
  ignoreNundef?: boolean,
): T {
  const result: Record<string, unknown> = {};
  if (payload) {
    (fieldNames ?? Object.keys(payload))?.forEach((fieldName) => {
      if (
        fieldName in payload &&
        (!ignoreNundef || !isNundef((payload as Record<string, unknown>)[fieldName]))
      ) {
        result[fieldName] = (payload as Record<string, unknown>)[fieldName];
      }
    });
  }
  return result as T;
}

export function transformFields(
  src: any,
  fieldMap: Record<string, boolean | ((value: any) => any)>,
) {
  const result: any = {};
  if (src) {
    Object.entries(fieldMap || {}).forEach(([fieldName, handler]) => {
      if (!(fieldName in src)) {
        return;
      }
      if (handler === true) {
        result[fieldName] = src[fieldName];
      } else if (typeof handler === 'function') {
        result[fieldName] = handler(src[fieldName]);
      }
    });
  }
  return result;
}

export function sort<T>(a: T, b: T) {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

export function isEmpty(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function isNundef(value: unknown) {
  return value === null || value === undefined;
}

export function isntEmpty(value: unknown) {
  return !isEmpty(value);
}

export function isntNundef(value: unknown) {
  return !isNundef(value);
}

export function fallbackValueIfEmpty<T>(value: T, fallbackValue: T) {
  return isEmpty(value) ? fallbackValue : value;
}

export function fallbackValueIfNundef<T>(value: T, fallbackValue: T) {
  return isNundef(value) ? fallbackValue : value;
}

export function normalizeArray<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return isNundef(value) ? [] : [value];
}

export function normalizeString(value: any): string {
  return isntNundef(value) ? `${value}` : '';
}

export function parseJsonString<T>(jsonString: string, fallbackValue?: T): T {
  if (!jsonString) return fallbackValue;
  try {
    return JSON.parse(jsonString);
  } catch (er) {
    return fallbackValue;
  }
}

export function initPlainObject<T>(keys: string[], initValue: T) {
  const result: Record<string, T> = {};
  keys.forEach((key) => {
    result[key] = initValue;
  });
  return result;
}

export function moveArrayItemPrev<T>(array: T[], index: number) {
  if (index > 0) {
    return [
      ...array.slice(0, index - 1),
      array[index],
      array[index - 1],
      ...array.slice(index + 1),
    ];
  }
  return array;
}

export function moveArrayItemNext<T>(array: T[], index: number) {
  if (index < array.length - 1) {
    return [...array.slice(0, index), array[index + 1], array[index], ...array.slice(index + 2)];
  }
  return array;
}

export function arrayToMap<T>(array: T[], keyField: string, valueField?: string) {
  return (array || []).reduce<Record<string, unknown>>((prev, current) => {
    const cur = current as Record<string, unknown>;
    const result = prev;
    result[String(cur[keyField])] = valueField ? cur[valueField] : current;
    return result;
  }, {});
}

export function mapToArray<T>(map: Record<string, T>, keyField?: string, valueField?: string) {
  return Object.entries(map || {}).map((entry) => {
    if (keyField && valueField) {
      return {
        [keyField]: entry[0],
        [valueField]: entry[1],
      };
    }
    return entry[1];
  });
}
