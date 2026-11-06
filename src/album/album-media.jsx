import { useState } from "react";

// Signed links may expire while an album stays open. Try a fresh API redirect,
// then the authenticated stream; album polling keeps the current element alive.
export function AlbumMedia({ sources, as: Element = "img", ...props }) {
  const [initialSources] = useState(() => sources);
  const [index, setIndex] = useState(0);
  return <Element {...props} src={initialSources[index]}
    onError={() => setIndex((i) => Math.min(i + 1, initialSources.length - 1))} />;
}
