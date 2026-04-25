import { button } from "@shared/dom";
import type { Difficulty } from "@shared/types";

const svgNamespace = "http://www.w3.org/2000/svg";

type SvgShape = {
  tag: "circle" | "line" | "path" | "polygon" | "polyline" | "rect";
  attrs: Record<string, string>;
};

export const uiClass = {
  action: "button interactive",
  pill: "pill surface interactive",
  touchAction: "touch-control pill surface interactive",
} as const;

export function actionButton(text: string): HTMLButtonElement {
  return button(text, uiClass.action);
}

export function pillButton(text: string): HTMLButtonElement {
  return button(text, uiClass.pill);
}

export function setSelected(element: HTMLElement, selected: boolean): void {
  element.dataset.selected = String(selected);
}

export function setIconLabel(element: HTMLElement, icon: string, label: string): void {
  const svg = svgIcon(icon);
  if (svg) element.replaceChildren(svg);
  else element.textContent = icon;
  element.setAttribute("aria-label", label);
  element.title = label;
}

export function difficultyIcon(difficulty: Difficulty): string {
  if (difficulty === "Easy") return "▮▯▯";
  if (difficulty === "Medium") return "▮▮▯";
  return "▮▮▮";
}

export function setDifficultyIconLabel(
  element: HTMLElement,
  difficulty: Difficulty | "Online",
): void {
  if (difficulty === "Online") {
    setIconLabel(element, "🌐", "Online");
    return;
  }
  setIconLabel(element, difficultyIcon(difficulty), difficulty);
}

function svgIcon(icon: string): SVGSVGElement | null {
  const shapes = svgIconShapes[icon];
  if (!shapes) return null;
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("class", "icon-glyph");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const shape of shapes) {
    const element = document.createElementNS(svgNamespace, shape.tag);
    for (const [name, value] of Object.entries(shape.attrs)) element.setAttribute(name, value);
    svg.append(element);
  }
  return svg;
}

const strokeShape = (tag: SvgShape["tag"], attrs: Record<string, string>): SvgShape => ({
  tag,
  attrs,
});

const fillShape = (tag: SvgShape["tag"], attrs: Record<string, string>): SvgShape => ({
  tag,
  attrs: { ...attrs, fill: "currentColor", stroke: "none" },
});

const svgIconShapes: Record<string, readonly SvgShape[]> = {
  "←": [strokeShape("path", { d: "M15 18l-6-6 6-6" }), strokeShape("path", { d: "M9 12h11" })],
  "⚙": [
    strokeShape("line", { x1: "4", y1: "7", x2: "20", y2: "7" }),
    strokeShape("line", { x1: "4", y1: "12", x2: "20", y2: "12" }),
    strokeShape("line", { x1: "4", y1: "17", x2: "20", y2: "17" }),
    fillShape("circle", { cx: "9", cy: "7", r: "2" }),
    fillShape("circle", { cx: "15", cy: "12", r: "2" }),
    fillShape("circle", { cx: "11", cy: "17", r: "2" }),
  ],
  "☀": [
    strokeShape("circle", { cx: "12", cy: "12", r: "4" }),
    strokeShape("line", { x1: "12", y1: "2.5", x2: "12", y2: "5" }),
    strokeShape("line", { x1: "12", y1: "19", x2: "12", y2: "21.5" }),
    strokeShape("line", { x1: "2.5", y1: "12", x2: "5", y2: "12" }),
    strokeShape("line", { x1: "19", y1: "12", x2: "21.5", y2: "12" }),
    strokeShape("line", { x1: "5.3", y1: "5.3", x2: "7.1", y2: "7.1" }),
    strokeShape("line", { x1: "16.9", y1: "16.9", x2: "18.7", y2: "18.7" }),
    strokeShape("line", { x1: "18.7", y1: "5.3", x2: "16.9", y2: "7.1" }),
    strokeShape("line", { x1: "7.1", y1: "16.9", x2: "5.3", y2: "18.7" }),
  ],
  "☾": [strokeShape("path", { d: "M20 15.5A8.5 8.5 0 1 1 8.5 4a6.7 6.7 0 0 0 11.5 11.5Z" })],
  "⏱": [
    strokeShape("path", { d: "M4 12a8 8 0 1 0 3-6.2" }),
    strokeShape("path", { d: "M4 4v5h5" }),
    strokeShape("path", { d: "M12 8v5l3 2" }),
  ],
  "🏆": [
    strokeShape("path", { d: "M8 4h8v4a4 4 0 0 1-8 0V4Z" }),
    strokeShape("path", { d: "M8 6H5v2a4 4 0 0 0 4 4" }),
    strokeShape("path", { d: "M16 6h3v2a4 4 0 0 1-4 4" }),
    strokeShape("path", { d: "M12 12v5" }),
    strokeShape("path", { d: "M8 20h8" }),
    strokeShape("path", { d: "M10 17h4" }),
  ],
  "🤖": [
    strokeShape("rect", { x: "5", y: "8", width: "14", height: "10", rx: "3" }),
    strokeShape("path", { d: "M12 5v3" }),
    fillShape("circle", { cx: "9", cy: "13", r: "1.4" }),
    fillShape("circle", { cx: "15", cy: "13", r: "1.4" }),
    strokeShape("path", { d: "M9 17h6" }),
  ],
  "👤": [
    strokeShape("circle", { cx: "12", cy: "8", r: "4" }),
    strokeShape("path", { d: "M5 21a7 7 0 0 1 14 0" }),
  ],
  "👥": [
    strokeShape("circle", { cx: "9", cy: "8", r: "3.2" }),
    strokeShape("circle", { cx: "16", cy: "9", r: "2.8" }),
    strokeShape("path", { d: "M3.5 21a6 6 0 0 1 11 0" }),
    strokeShape("path", { d: "M13 20a5.5 5.5 0 0 1 7.5 0" }),
  ],
  "🌐": [
    strokeShape("circle", { cx: "12", cy: "12", r: "9" }),
    strokeShape("path", { d: "M3.5 12h17" }),
    strokeShape("path", { d: "M12 3a13 13 0 0 1 0 18" }),
    strokeShape("path", { d: "M12 3a13 13 0 0 0 0 18" }),
  ],
  "↻": [
    strokeShape("path", { d: "M20 12a8 8 0 1 1-2.3-5.7" }),
    strokeShape("path", { d: "M20 4v6h-6" }),
  ],
  "↺": [
    strokeShape("path", { d: "M4 12a8 8 0 1 0 2.3-5.7" }),
    strokeShape("path", { d: "M4 4v6h6" }),
  ],
  "▶": [fillShape("polygon", { points: "8,5 19,12 8,19" })],
  "⏸": [
    fillShape("rect", { x: "7", y: "5", width: "3.8", height: "14", rx: "1" }),
    fillShape("rect", { x: "13.2", y: "5", width: "3.8", height: "14", rx: "1" }),
  ],
  "✓": [strokeShape("polyline", { points: "5 13 10 18 20 6" })],
  "▮▯▯": [
    fillShape("rect", { x: "5", y: "14", width: "3.5", height: "5", rx: "0.8" }),
    fillShape("rect", {
      x: "10.25",
      y: "10",
      width: "3.5",
      height: "9",
      rx: "0.8",
      opacity: "0.28",
    }),
    fillShape("rect", {
      x: "15.5",
      y: "6",
      width: "3.5",
      height: "13",
      rx: "0.8",
      opacity: "0.28",
    }),
  ],
  "▮▮▯": [
    fillShape("rect", { x: "5", y: "14", width: "3.5", height: "5", rx: "0.8" }),
    fillShape("rect", { x: "10.25", y: "10", width: "3.5", height: "9", rx: "0.8" }),
    fillShape("rect", {
      x: "15.5",
      y: "6",
      width: "3.5",
      height: "13",
      rx: "0.8",
      opacity: "0.28",
    }),
  ],
  "▮▮▮": [
    fillShape("rect", { x: "5", y: "14", width: "3.5", height: "5", rx: "0.8" }),
    fillShape("rect", { x: "10.25", y: "10", width: "3.5", height: "9", rx: "0.8" }),
    fillShape("rect", { x: "15.5", y: "6", width: "3.5", height: "13", rx: "0.8" }),
  ],
};
