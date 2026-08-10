const $ = (s) => document.querySelector(s);
const matchesList = $("#matches-list");
const standingsSections = $("#standings-sections");
const playoffList = $("#playoff-list");
const playoffBox = $("#playoff-box");
const annualBody = $("#annual-body");
const averagesBody = $("#averages-body");
const annualBox = $("#annual-box");
const averagesBox = $("#averages-box");
const matchesTitle = $("#matches-title");
const liveStatus = $("#live-status");
const refreshBtn = $("#refresh-btn");
const liveOnlyInput = $("#live-only");
const liveOnlyWrap = $("#live-only-wrap");
const matchModal = $("#match-modal");
const modalContent = $("#modal-content");
const modalClose = $("#modal-close");
const detailPageRoot = $("#match-detail-page");
const detailBackBtn = $("#detail-back-btn");
const torneoSwitch = $("#torneo-switch");
const seasonSelect = $("#season-select");
const isDetailPage = Boolean(detailPageRoot);

export {
  $, matchesList, standingsSections, playoffList, playoffBox, annualBody, averagesBody,
  annualBox, averagesBox, matchesTitle, liveStatus, refreshBtn, liveOnlyInput, liveOnlyWrap,
  matchModal, modalContent, modalClose, detailPageRoot, detailBackBtn, torneoSwitch, seasonSelect,
  isDetailPage
};
