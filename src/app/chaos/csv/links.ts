/** Addresses of a library CSV (shared by the dashboard and the CSV page). */
export const csvViewHref = (name: string) => `/chaos/csv/${encodeURIComponent(name)}`;
export const csvFileHref = (name: string) => `/chaos/csv/${encodeURIComponent(name)}/file`;
/** The studio (quiz or facts tab) with this CSV already loaded. */
export const makeVideoHref = (name: string, kind: "quiz" | "facts") => `/chaos?${kind === "facts" ? "type=facts&" : ""}csv=${encodeURIComponent(name)}`;
/** A file name from the address (Next may hand it over still encoded). */
export const nameFromParam = (p: string) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};
