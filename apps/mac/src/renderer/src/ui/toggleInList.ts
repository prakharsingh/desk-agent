// Shared by WidgetsPane (visibleWidgets) and PluginsPane (enabledPlugins) --
// both previously defined their own identically-bodied toggle function.
export function toggleInList(list: string[], id: string, on: boolean): string[] {
  if (on) return list.includes(id) ? list : [...list, id];
  return list.filter((existing) => existing !== id);
}
