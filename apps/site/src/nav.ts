// Added by the site build to every app page (vite.config.ts): a link back to the home page. A page that has a place
// for it (an element with data-home-slot, e.g. Shadow Battle's menu) gets a button there; the others a small pill in
// the corner that shows while the mouse moves and hides when playing. The apps themselves don't know about the site.
import "./nav.css";

const HIDE_MS = 2500;

function homeLink(): void {
  const link = document.createElement("a");
  link.href = import.meta.env.BASE_URL;
  link.className = "fso-home";
  link.textContent = "Four Swords Online";
  link.title = "Home: the ways to play";
  const slot = document.querySelector<HTMLElement>("[data-home-slot]");
  if (slot) {
    link.textContent = "Home";
    link.classList.add("btn", "in-slot");
    slot.replaceWith(link);
    return;
  }
  link.classList.add("floating");
  document.body.append(link);
  let timer = 0;
  const hide = () => !link.matches(":hover, :focus-visible") && link.classList.add("away");
  const show = () => {
    link.classList.remove("away");
    clearTimeout(timer);
    timer = window.setTimeout(hide, HIDE_MS);
  };
  // A mouse moving shows it; on a touch screen a tap does, except on the on-screen controls (@fso/input/touch).
  window.addEventListener("pointermove", (e) => e.pointerType !== "touch" && show(), { passive: true });
  window.addEventListener("pointerdown", (e) => e.pointerType === "touch" && !(e.target as Element).closest?.(".fso-touch") && show(), { passive: true });
  window.addEventListener("keydown", hide, { capture: true, passive: true });
  link.addEventListener("pointerleave", () => (timer = window.setTimeout(hide, HIDE_MS)));
  show();
}

homeLink();
