import { SDK_ENTRIES, type SdkEntry } from '@jixie/shared';
import { BaseStore } from '@src/lib';

export class SdkStore extends BaseStore {
  public readonly entries = SDK_ENTRIES;
  public readonly groups = groupEntries(this.entries);
}

function groupEntries(entries: readonly SdkEntry[]): [string, SdkEntry[]][] {
  const groupOrder: string[] = [];
  const entriesByGroup = new Map<string, SdkEntry[]>();

  for (const entry of entries) {
    if (!entriesByGroup.has(entry.group)) {
      entriesByGroup.set(entry.group, []);
      groupOrder.push(entry.group);
    }
    entriesByGroup.get(entry.group)!.push(entry);
  }

  return groupOrder.map((group) => [group, entriesByGroup.get(group)!]);
}
