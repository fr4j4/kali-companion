import React from "react";
import type { WindowType } from "../../workspace/types";
import { DEFAULT_SIZES, WINDOW_ICONS } from "../../workspace/types";

export interface WidgetEntry {
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  width: number;
  height: number | null;
  icon: string;
  resizable: boolean;
  minW: number;
  minH: number;
}

const LazyEntityCard = React.lazy(() => import("./EntityCardWidget").then((m) => ({ default: m.EntityCardWidget })));
const LazyResourceCard = React.lazy(() => import("./ResourceCardWidget").then((m) => ({ default: m.ResourceCardWidget })));
const LazyPlaceCard = React.lazy(() => import("./PlaceCardWidget").then((m) => ({ default: m.PlaceCardWidget })));
const LazyMedia = React.lazy(() => import("./MediaWidget").then((m) => ({ default: m.MediaWidget })));
const LazyDocument = React.lazy(() => import("./DocumentWidget").then((m) => ({ default: m.DocumentWidget })));
const LazyCode = React.lazy(() => import("./CodeWidget").then((m) => ({ default: m.CodeWidget })));
const LazyMermaid = React.lazy(() => import("./MermaidWidget").then((m) => ({ default: m.MermaidWidget })));
const LazyDiff = React.lazy(() => import("./DiffWidget").then((m) => ({ default: m.DiffWidget })));
const LazyJson = React.lazy(() => import("./JsonTreeWidget").then((m) => ({ default: m.JsonTreeWidget })));
const LazyTerminal = React.lazy(() => import("./TerminalWidget").then((m) => ({ default: m.TerminalWidget })));
const LazyTable = React.lazy(() => import("./TableWidget").then((m) => ({ default: m.TableWidget })));
const LazyChart = React.lazy(() => import("./ChartWidget").then((m) => ({ default: m.ChartWidget })));
const LazyQuiz = React.lazy(() => import("./QuizWidget").then((m) => ({ default: m.QuizWidget })));
const LazyChecklist = React.lazy(() => import("./ChecklistWidget").then((m) => ({ default: m.ChecklistWidget })));
const LazyControls = React.lazy(() => import("./ControlsWidget").then((m) => ({ default: m.ControlsWidget })));
const LazyImage = React.lazy(() => import("./ImageWidget").then((m) => ({ default: m.ImageWidget })));
const LazyLink = React.lazy(() => import("./LinkWidget").then((m) => ({ default: m.LinkWidget })));
const LazyQr = React.lazy(() => import("./QrWidget").then((m) => ({ default: m.QrWidget })));
const LazyPlaceholder = React.lazy(() => import("./PlaceholderWidget").then((m) => ({ default: m.PlaceholderWidget })));
const LazyHtml = React.lazy(() => import("./HtmlWidget").then((m) => ({ default: m.HtmlWidget })));

function sz(type: WindowType) {
  return DEFAULT_SIZES[type] || { width: 340, height: null };
}

export const widgetRegistry: Partial<Record<WindowType, WidgetEntry>> = {
  entity: {
    component: LazyEntityCard,
    width: sz("entity").width,
    height: sz("entity").height,
    icon: WINDOW_ICONS.entity,
    resizable: true,
    minW: 280,
    minH: 200,
  },
  resource: {
    component: LazyResourceCard,
    width: sz("resource").width,
    height: sz("resource").height,
    icon: WINDOW_ICONS.resource,
    resizable: true,
    minW: 260,
    minH: 180,
  },
  place: {
    component: LazyPlaceCard,
    width: sz("place").width,
    height: sz("place").height,
    icon: WINDOW_ICONS.place,
    resizable: true,
    minW: 300,
    minH: 200,
  },
  media: {
    component: LazyMedia,
    width: sz("media").width,
    height: sz("media").height,
    icon: WINDOW_ICONS.media,
    resizable: true,
    minW: 280,
    minH: 180,
  },
  document: {
    component: LazyDocument,
    width: sz("document").width,
    height: sz("document").height,
    icon: WINDOW_ICONS.document,
    resizable: true,
    minW: 300,
    minH: 200,
  },
  code: {
    component: LazyCode,
    width: sz("code").width,
    height: sz("code").height,
    icon: WINDOW_ICONS.code,
    resizable: true,
    minW: 280,
    minH: 200,
  },
  mermaid: {
    component: LazyMermaid,
    width: sz("mermaid").width,
    height: sz("mermaid").height,
    icon: WINDOW_ICONS.mermaid,
    resizable: true,
    minW: 280,
    minH: 200,
  },
  diff: {
    component: LazyDiff,
    width: sz("diff").width,
    height: sz("diff").height,
    icon: WINDOW_ICONS.diff,
    resizable: true,
    minW: 260,
    minH: 180,
  },
  json: {
    component: LazyJson,
    width: sz("json").width,
    height: sz("json").height,
    icon: WINDOW_ICONS.json,
    resizable: true,
    minW: 260,
    minH: 200,
  },
  terminal: {
    component: LazyTerminal,
    width: sz("terminal").width,
    height: sz("terminal").height,
    icon: WINDOW_ICONS.terminal,
    resizable: true,
    minW: 280,
    minH: 200,
  },
  table: {
    component: LazyTable,
    width: sz("table").width,
    height: sz("table").height,
    icon: WINDOW_ICONS.table,
    resizable: true,
    minW: 280,
    minH: 180,
  },
  chart: {
    component: LazyChart,
    width: sz("chart").width,
    height: sz("chart").height,
    icon: WINDOW_ICONS.chart,
    resizable: true,
    minW: 280,
    minH: 240,
  },
  quiz: {
    component: LazyQuiz,
    width: sz("quiz").width,
    height: sz("quiz").height,
    icon: WINDOW_ICONS.quiz,
    resizable: true,
    minW: 260,
    minH: 240,
  },
  checklist: {
    component: LazyChecklist,
    width: sz("checklist").width,
    height: sz("checklist").height,
    icon: WINDOW_ICONS.checklist,
    resizable: true,
    minW: 260,
    minH: 200,
  },
  controls: {
    component: LazyControls,
    width: sz("controls").width,
    height: sz("controls").height,
    icon: WINDOW_ICONS.controls,
    resizable: true,
    minW: 260,
    minH: 260,
  },
  image: {
    component: LazyImage,
    width: sz("image").width,
    height: sz("image").height,
    icon: WINDOW_ICONS.image,
    resizable: true,
    minW: 200,
    minH: 180,
  },
  link: {
    component: LazyLink,
    width: sz("link").width,
    height: sz("link").height,
    icon: WINDOW_ICONS.link,
    resizable: true,
    minW: 260,
    minH: 80,
  },
  qr: {
    component: LazyQr,
    width: sz("qr").width,
    height: sz("qr").height,
    icon: WINDOW_ICONS.qr,
    resizable: true,
    minW: 220,
    minH: 240,
  },
  widget: {
    component: LazyPlaceholder,
    width: sz("widget").width,
    height: sz("widget").height,
    icon: WINDOW_ICONS.widget,
    resizable: true,
    minW: 260,
    minH: 160,
  },
  html: {
    component: LazyHtml,
    width: sz("html").width,
    height: sz("html").height,
    icon: WINDOW_ICONS.html,
    resizable: true,
    minW: 300,
    minH: 200,
  },
};
