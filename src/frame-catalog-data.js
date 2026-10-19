export const frameTheme = (frame) => frame.themeName?.trim() || "";
export const compareFrameOrder = (a, b) =>
  (a.order || 0) - (b.order || 0) ||
  String(a._id).localeCompare(String(b._id), "en");

// Display aliases stay stable when filtering/reordering. Stored names are preserved.
export function frameDisplayNames(items) {
  const groups = new Map();
  for (const frame of [...items].sort((a, b) =>
    String(a._id).localeCompare(String(b._id), "en"),
  )) {
    const name = frame.name?.trim() || "Khung chưa đặt tên";
    const key = JSON.stringify([
      frameTheme(frame),
      name.toLocaleLowerCase("vi"),
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...frame, name });
  }
  const names = new Map();
  for (const group of groups.values())
    group.forEach((frame, i) =>
      names.set(
        frame._id,
        group.length > 1
          ? `${frame.name} · ${String(i + 1).padStart(2, "0")}`
          : frame.name,
      ),
    );
  return names;
}
