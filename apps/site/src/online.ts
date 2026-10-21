// /online/ is a short address for Shadow Battle's online lobby (apps/battle, deep link #online). Anything after # is
// passed along, so /online/#join=CODE opens that room.
const extra = location.hash.slice(1);
const target = `${import.meta.env.BASE_URL}battle/#online${extra ? `&${extra}` : ""}`;
(document.getElementById("go") as HTMLAnchorElement | null)?.setAttribute("href", target);
location.replace(target);
