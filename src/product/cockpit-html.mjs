export const COCKPIT_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>天枢 · 奈奈工作台</title>
  <style>
    :root {
      --canvas: #f3f5f2;
      --surface: #ffffff;
      --surface-2: #eef1ed;
      --ink: #17211c;
      --muted: #65716a;
      --line: #d9dfda;
      --line-strong: #bdc8c0;
      --sidebar: #17231d;
      --sidebar-muted: #9eaaa3;
      --green: #12664f;
      --green-soft: #e4f1eb;
      --blue: #315f85;
      --blue-soft: #e8eff5;
      --amber: #946914;
      --amber-soft: #f6efd9;
      --red: #a9473d;
      --red-soft: #f8e9e6;
      --shadow: 0 18px 48px rgba(23, 33, 28, .14);
      font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    html { background: var(--canvas); color: var(--ink); }
    body { margin: 0; min-height: 100vh; background: var(--canvas); }
    button, input, textarea, select { font: inherit; letter-spacing: 0; }
    button { cursor: pointer; }
    button:disabled { cursor: wait; opacity: .55; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { margin-bottom: 8px; font-size: 30px; line-height: 1.22; letter-spacing: 0; }
    h2 { margin-bottom: 6px; font-size: 20px; line-height: 1.35; letter-spacing: 0; }
    h3 { margin-bottom: 5px; font-size: 16px; line-height: 1.45; letter-spacing: 0; }
    p { margin-bottom: 0; line-height: 1.65; }
    ul { margin: 8px 0 0; padding-left: 20px; line-height: 1.7; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 224px minmax(0, 1fr); }
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 20; width: 224px; display: flex; flex-direction: column; padding: 24px 16px 18px; color: #f7faf8; background: var(--sidebar); border-right: 1px solid #29372f; }
    .brand { display: flex; align-items: center; gap: 11px; padding: 0 8px 25px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; flex: none; border-radius: 6px; background: #d7eadf; color: #154c3d; font-weight: 800; }
    .brand strong { display: block; font-size: 17px; }
    .brand span { display: block; margin-top: 3px; color: var(--sidebar-muted); font-size: 12px; }
    .nav { display: grid; gap: 4px; }
    .nav button { width: 100%; min-height: 44px; display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 9px; padding: 0 11px; color: #c6d0ca; background: transparent; border: 0; border-radius: 6px; text-align: left; }
    .nav button:hover { background: #223129; color: #fff; }
    .nav button.active { background: #e6f1eb; color: #153d31; font-weight: 700; }
    .nav-icon { width: 20px; text-align: center; font-size: 13px; font-weight: 800; }
    .nav-count { min-width: 20px; height: 20px; display: grid; place-items: center; padding: 0 5px; border: 1px solid currentColor; border-radius: 10px; font-size: 11px; }
    .nav-count[hidden] { display: none !important; }
    .sidebar-foot { margin-top: auto; padding: 16px 8px 0; border-top: 1px solid #344239; color: var(--sidebar-muted); font-size: 12px; line-height: 1.7; }
    .sidebar-foot strong { display: block; color: #dce5df; font-size: 13px; }
    .main { grid-column: 2; min-width: 0; }
    .topbar { position: sticky; top: 0; z-index: 15; height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 34px; background: rgba(243, 245, 242, .96); border-bottom: 1px solid var(--line); backdrop-filter: blur(10px); }
    .top-title { display: flex; align-items: baseline; gap: 13px; min-width: 0; }
    .top-title strong { font-size: 15px; }
    .top-title span { color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .health { display: flex; align-items: center; gap: 8px; flex: none; color: var(--green); font-size: 13px; font-weight: 700; }
    .health::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px rgba(18, 102, 79, .10); }
    .health.offline { color: var(--red); }
    .offline { display: none; padding: 11px 34px; color: #7c332d; background: var(--red-soft); border-bottom: 1px solid #edc7c1; font-size: 13px; }
    .offline.show { display: block; }
    .content { width: min(1360px, 100%); margin: 0 auto; padding: 32px 34px 70px; }
    .view { display: none; }
    .view.active { display: block; }
    .view-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
    .eyebrow { color: var(--green); font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .muted { color: var(--muted); }
    .small { font-size: 12px; }
    .button { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; color: var(--ink); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 5px; font-weight: 700; }
    .button:hover { border-color: #829188; }
    .button.primary { color: #fff; background: var(--green); border-color: var(--green); }
    .button.danger { color: var(--red); border-color: #d9a9a3; }
    .button.quiet { background: transparent; border-color: transparent; }
    .button.compact { min-height: 32px; padding: 0 10px; font-size: 12px; }
    .icon-button { width: 38px; height: 38px; padding: 0; display: grid; place-items: center; color: var(--muted); background: transparent; border: 1px solid transparent; border-radius: 5px; font-size: 24px; }
    .icon-button:hover { color: var(--ink); border-color: var(--line); }
      .composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; width: 100%; max-width: 100%; overflow: hidden; padding: 18px; background: var(--surface); border: 1px solid var(--line-strong); border-radius: 6px; box-shadow: 0 8px 24px rgba(23, 33, 28, .05); }
    .composer.dragging { border-color: var(--green); box-shadow: 0 0 0 3px rgba(18,102,79,.1); }
    .composer textarea { grid-column: 1 / -1; width: 100%; min-height: 84px; max-height: 220px; resize: vertical; padding: 3px 4px; color: var(--ink); background: transparent; border: 0; outline: 0; line-height: 1.65; }
    .composer-tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .tool-button { min-height: 36px; padding: 0 11px; color: #3e4b44; background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; font-size: 12px; font-weight: 750; }
    .tool-button:hover { border-color: var(--line-strong); background: #fff; }
    .tool-button.listening { color: #fff; background: var(--red); border-color: var(--red); }
    .composer > .button { align-self: end; min-width: 112px; }
    .attachment-tray { grid-column: 1 / -1; display: grid; gap: 7px; }
    .attachment-summary { display: flex; justify-content: space-between; gap: 12px; padding: 10px 11px; color: var(--green); background: var(--green-soft); border-left: 3px solid var(--green); font-size: 12px; }
    .attachment-item { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 10px 11px; background: #f6f8f6; border: 1px solid var(--line); border-radius: 4px; }
    .attachment-item strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .attachment-item span { color: var(--muted); font-size: 11px; }
    .attachment-remove { min-height: 28px; padding: 0 8px; color: var(--red); background: transparent; border: 0; font-size: 11px; }
    .material-list { display: grid; gap: 7px; margin-top: 13px; }
    .material-line { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; padding: 9px 11px; background: var(--surface-2); border-left: 3px solid var(--green); font-size: 12px; }
    .material-line strong, .material-line small { display: block; overflow-wrap: anywhere; }
    .material-line small { margin-top: 3px; color: var(--muted); }
    .brief-panel { margin-top: 14px; padding: 16px; background: var(--green-soft); border-left: 4px solid var(--green); }
    .brief-panel h3 { margin: 0 0 8px; font-size: 15px; }
    .brief-panel p { margin: 5px 0; line-height: 1.65; }
    .composer-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 10px 2px 0; color: var(--muted); font-size: 12px; }
    .intake-guide { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 12px; background: var(--surface); border: 1px solid var(--line); }
    .intake-guide-item { min-height: 72px; padding: 13px 15px; border-right: 1px solid var(--line); }
    .intake-guide-item:last-child { border-right: 0; }
    .intake-guide-item strong { display: block; margin-bottom: 5px; font-size: 13px; }
    .intake-guide-item span { color: var(--muted); font-size: 11px; line-height: 1.5; }
    .grid-main { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(310px, .8fr); gap: 28px; align-items: start; }
    .column { min-width: 0; display: grid; gap: 30px; }
    .section { min-width: 0; }
    .section-head { min-height: 36px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 13px; }
    .section-head p { font-size: 13px; }
    .result-panel { margin-top: 18px; padding: 18px 20px; background: var(--green-soft); border-left: 4px solid var(--green); }
    .result-panel.error { background: var(--red-soft); border-color: var(--red); }
    .conversation { display: grid; gap: 14px; margin-top: 18px; }
    .conversation-turn { display: grid; gap: 8px; }
    .conversation-user { justify-self: end; max-width: min(78%, 720px); padding: 11px 14px; background: #e9ece9; border-radius: 6px 6px 2px 6px; line-height: 1.6; overflow-wrap: anywhere; }
      .conversation-assistant { max-width: min(92%, 880px); overflow-wrap: anywhere; padding: 17px 18px; background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--green); border-radius: 2px 6px 6px 6px; }
    .conversation-assistant h3 { margin: 6px 0 7px; }
    .conversation-assistant p { color: #435049; white-space: pre-line; }
    .conversation-question { margin-top: 14px; padding: 13px 14px; background: var(--amber-soft); border-left: 3px solid var(--amber); }
    .conversation-question strong { display: block; margin-bottom: 5px; }
    .conversation-section { margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--line); }
    .conversation-section strong { display: block; margin-bottom: 5px; font-size: 12px; }
    .result-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(18, 102, 79, .18); }
    .result-grid strong { display: block; margin-bottom: 4px; font-size: 12px; }
    .focus-panel { padding: 21px; color: #f6faf7; background: #1e3c31; border-radius: 6px; }
    .focus-panel .eyebrow { color: #9fd0ba; }
    .focus-title { margin: 8px 0 10px; font-size: 22px; font-weight: 800; line-height: 1.35; }
    .focus-next { margin-top: 17px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,.16); }
    .metric-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--line); background: var(--surface); }
    .metric { min-height: 88px; padding: 16px; border-right: 1px solid var(--line); }
    .metric:last-child { border-right: 0; }
    .metric strong { display: block; margin-top: 7px; font-size: 26px; line-height: 1; }
    .queue { display: grid; gap: 9px; }
    .confirmation { display: grid; grid-template-columns: 118px minmax(0, 1fr) auto; gap: 18px; align-items: center; min-height: 118px; padding: 17px 18px; background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--blue); border-radius: 6px; }
    .confirmation.urgent { border-left-color: var(--red); }
    .confirmation.low { border-left-color: var(--line-strong); }
    .confirmation p { color: var(--muted); font-size: 13px; }
    .origin-line { margin-top: 8px; color: #435049; font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .type { display: inline-flex; align-items: center; min-height: 25px; padding: 0 8px; color: var(--blue); background: var(--blue-soft); border-radius: 3px; font-size: 11px; font-weight: 800; }
    .type.execution { color: var(--amber); background: var(--amber-soft); }
    .type.learning { color: var(--green); background: var(--green-soft); }
    .badge { display: inline-flex; align-items: center; min-height: 24px; padding: 0 8px; color: #526058; background: var(--surface-2); border-radius: 3px; font-size: 11px; font-weight: 700; }
    .badge.active { color: var(--green); background: var(--green-soft); }
    .badge.candidate { color: var(--amber); background: var(--amber-soft); }
    .badge.rejected { color: var(--red); background: var(--red-soft); }
    .project-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .project-card { min-height: 180px; padding: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
    .project-card.featured { border-top: 4px solid var(--green); }
    .project-card.selected { border-color: var(--green); box-shadow: 0 0 0 2px var(--green-soft); }
    .project-top { display: flex; justify-content: space-between; gap: 16px; }
    .score { min-width: 82px; text-align: right; }
    .score strong { display: block; color: var(--green); font-size: 24px; line-height: 1; }
    .score small { display: block; margin-top: 6px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .progress-track { height: 8px; margin-top: 13px; overflow: hidden; background: var(--surface-2); border-radius: 4px; }
    .progress-fill { height: 100%; background: var(--green); border-radius: inherit; transition: width .25s ease; }
    .progress-fill.pending { background: var(--amber); }
    .progress-line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 12px; }
    .progress-line strong { font-size: 14px; }
    .progress-line span { color: var(--muted); font-size: 11px; }
    .live-status { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .live-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--line-strong); }
    .live-status.connected { color: var(--green); }
    .live-status.connected::before { background: var(--green); box-shadow: 0 0 0 3px var(--green-soft); }
    .progress-pending { margin-top: 10px; padding: 8px 10px; color: #6d5310; background: var(--amber-soft); border-left: 3px solid var(--amber); font-size: 11px; line-height: 1.5; }
    .project-actions { display: flex; justify-content: flex-end; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
    .project-workspace { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 20px; margin-top: 16px; padding: 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
    .readiness-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .readiness-item { min-height: 132px; padding: 16px; background: var(--surface); border: 1px solid var(--line); border-top: 3px solid var(--line-strong); }
    .readiness-item.ready { border-top-color: var(--green); }
    .readiness-item.pending { border-top-color: var(--amber); }
    .readiness-item strong { display: block; margin: 8px 0 5px; font-size: 16px; line-height: 1.45; }
    .workspace-summary { display: grid; gap: 10px; align-content: start; }
    .workspace-stat { padding: 13px; background: var(--surface-2); }
    .workspace-stat strong { display: block; margin-top: 4px; font-size: 17px; line-height: 1.4; overflow-wrap: anywhere; }
    .workspace-stat.primary { color: #fff; background: var(--green); }
    .workspace-stat.primary .muted { color: #d7e9e0; }
    .workspace-stat.material { background: var(--blue-soft); border-left: 3px solid var(--blue); }
    .workspace-stat-note { display: block; margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .milestone-list { display: grid; gap: 8px; margin-top: 12px; }
    .milestone-item { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; background: var(--surface-2); font-size: 12px; }
    .milestone-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--line-strong); }
    .milestone-dot.completed { background: var(--green); }
    .milestone-dot.in_progress { background: var(--blue); }
    .milestone-dot.blocked { background: var(--red); }
    .project-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 13px; }
    .blockers { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--red); font-size: 12px; line-height: 1.6; }
    .reminder { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; padding: 13px 0; border-bottom: 1px solid var(--line); }
    .reminder:last-child { border-bottom: 0; }
    .automation-list { border-top: 1px solid var(--line); }
    .automation { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); }
    .split { display: grid; grid-template-columns: minmax(280px, .72fr) minmax(0, 1.55fr); gap: 20px; align-items: start; }
    .list-panel { display: grid; gap: 5px; max-height: calc(100vh - 180px); overflow: auto; position: sticky; top: 88px; }
    .list-item { width: 100%; padding: 14px; color: var(--ink); background: transparent; border: 1px solid transparent; border-radius: 5px; text-align: left; }
    .list-item:hover { background: var(--surface-2); }
    .list-item.active { background: var(--surface); border-color: var(--line-strong); }
    .list-item span { display: block; margin-top: 6px; color: var(--muted); font-size: 11px; }
    .detail { padding: 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
    .detail-section { margin-top: 21px; padding-top: 18px; border-top: 1px solid var(--line); }
    .fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .fact { padding: 12px; background: var(--surface-2); font-size: 13px; line-height: 1.6; }
    .pipeline { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); background: var(--surface); border: 1px solid var(--line); }
    .pipeline-step { min-height: 98px; padding: 15px; border-right: 1px solid var(--line); }
    .pipeline-step:last-child { border-right: 0; }
    .pipeline-step strong { display: block; margin-top: 10px; font-size: 24px; }
    .work-item { padding: 18px 0; border-bottom: 1px solid var(--line); }
    .work-item:first-child { padding-top: 0; }
    .work-item:last-child { border-bottom: 0; }
    .work-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
    .work-stages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
    .stage { min-height: 65px; padding: 10px; background: var(--surface-2); font-size: 12px; }
    .job { display: grid; grid-template-columns: minmax(0, 1fr) 120px 100px auto; gap: 12px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line); }
    .job-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .experience { display: grid; grid-template-columns: minmax(220px, .6fr) minmax(0, 1.4fr) minmax(180px, .5fr); gap: 24px; padding: 20px 0; border-bottom: 1px solid var(--line); }
    .rule { padding: 14px 16px; background: var(--green-soft); border-left: 3px solid var(--green); line-height: 1.7; }
    .empty { padding: 26px; color: var(--muted); background: rgba(255,255,255,.5); border: 1px dashed var(--line-strong); text-align: center; }
    .overlay { position: fixed; inset: 0; z-index: 50; display: none; align-items: center; justify-content: center; padding: 22px; background: rgba(12, 20, 16, .54); }
    .overlay.show { display: flex; }
    .modal { width: min(820px, 100%); max-height: calc(100vh - 36px); overflow: auto; background: var(--surface); border-radius: 6px; box-shadow: var(--shadow); }
    .modal-head { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; gap: 20px; padding: 20px 24px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
    .modal-body { padding: 22px 24px; }
    .modal-foot { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 10px; padding: 15px 24px; background: var(--surface); border-top: 1px solid var(--line); }
    .source-box { margin-bottom: 18px; padding: 14px 16px; background: var(--surface-2); border-left: 3px solid var(--blue); }
    .preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .preview-block { padding: 14px; background: #f8faf8; border: 1px solid var(--line); }
    .preview-block.wide { grid-column: 1 / -1; }
    .preview-block strong { display: block; margin-bottom: 7px; font-size: 12px; }
    .consequence { margin: 18px 0; padding: 14px 16px; background: var(--amber-soft); border-left: 3px solid var(--amber); line-height: 1.65; }
    .choices { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
    .choice { min-height: 38px; padding: 0 14px; color: var(--ink); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 5px; font-weight: 700; }
    .choice.selected { color: #fff; background: var(--green); border-color: var(--green); }
    .field { margin-top: 14px; }
    .field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field label { display: block; margin-bottom: 6px; color: #46534c; font-size: 12px; font-weight: 700; }
    .field input, .field textarea, .field select { width: 100%; padding: 10px 11px; color: var(--ink); background: #fff; border: 1px solid var(--line-strong); border-radius: 4px; outline: 0; }
    .field textarea { min-height: 84px; resize: vertical; line-height: 1.6; }
    .field input:focus, .field textarea:focus, .field select:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(18, 102, 79, .09); }
    .audit { margin-top: 20px; color: var(--muted); font-size: 12px; }
    .audit summary { cursor: pointer; }
    .audit pre { max-height: 280px; overflow: auto; padding: 12px; color: #d8e1dc; background: #18211c; white-space: pre-wrap; word-break: break-word; }
      .toast { position: fixed; z-index: 80; right: 24px; bottom: 24px; max-width: 380px; padding: 12px 16px; color: #fff; background: #17211c; border-radius: 5px; opacity: 0; transform: translateY(10px); pointer-events: none; transition: .18s ease; }
      .toast.show { opacity: 1; transform: translateY(0); }
      .mobile-intake-launch { display: none; }
      .mobile-intake-launch.is-hidden { display: none !important; }
    @media (max-width: 1060px) {
      .app { grid-template-columns: 78px minmax(0,1fr); }
      .sidebar { width: 78px; padding-inline: 10px; }
      .brand { justify-content: center; padding-inline: 0; }
      .brand div:last-child, .nav button span:nth-child(2), .sidebar-foot { display: none; }
      .nav button { grid-template-columns: 1fr; justify-items: center; padding: 0; }
      .nav-count { position: absolute; margin: -23px 0 0 27px; background: var(--sidebar); }
      .nav button.active .nav-count { background: var(--green-soft); }
      .main { grid-column: 2; }
      .grid-main { grid-template-columns: 1fr; }
      .project-list { grid-template-columns: 1fr; }
    }
    @media (max-width: 720px) {
      html, body { max-width: 100%; overflow-x: hidden; }
      .app { display: block; padding-bottom: 64px; }
      .app, .main, .content, .view, .grid-main, .column, .section {
        min-width: 0;
        max-width: 100%;
      }
      .sidebar { inset: auto 0 0; width: 100%; height: 64px; padding: 7px 8px; border: 0; border-top: 1px solid #344239; }
      .brand, .sidebar-foot { display: none; }
      .nav { grid-template-columns: repeat(5, 1fr); gap: 0; }
      .nav button { min-height: 49px; display: flex; flex-direction: column; justify-content: center; gap: 2px; font-size: 10px; }
      .nav button span:nth-child(2) { display: block; }
      .nav-icon { display: none; }
      .nav-count { position: static; order: -1; margin: 0; background: transparent; }
      .nav button.active .nav-count { background: transparent; }
      .main { display: block; }
      .topbar { height: 58px; padding: 0 16px; }
      .top-title span { display: none; }
      .content { padding: 22px 16px 128px; }
      .view-head, .section-head { min-width: 0; }
      .view-head { align-items: flex-start; }
      .view-head > .muted { display: none; }
      h1 { font-size: 25px; }
      .composer, .composer textarea, .composer-tools, .confirmation { min-width: 0; max-width: 100%; }
      .composer { display: flex; flex-direction: column; align-items: stretch; }
      .composer textarea { width: 100%; overflow-wrap: anywhere; }
      .composer > .button { width: 100%; min-width: 0; }
      .composer-tools {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        justify-content: stretch;
        width: 100%;
      }
      .composer-tools .tool-button { min-width: 0; width: 100%; }
      .intake-guide { grid-template-columns: 1fr; }
      .intake-guide-item { min-height: 0; border-right: 0; border-bottom: 1px solid var(--line); }
      .intake-guide-item:last-child { border-bottom: 0; }
      .metric-strip, .pipeline { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .metric, .pipeline-step { border-bottom: 1px solid var(--line); }
      .confirmation { grid-template-columns: 1fr; gap: 10px; }
      .confirmation .button { width: 100%; }
      .confirmation h3, .confirmation p { overflow-wrap: anywhere; }
      .result-grid, .preview-grid, .field-row, .fact-grid { grid-template-columns: 1fr; }
      .conversation-user, .conversation-assistant { max-width: 100%; }
      .preview-block.wide { grid-column: auto; }
      .split { grid-template-columns: 1fr; }
      .project-workspace { grid-template-columns: 1fr; padding: 16px; }
      .readiness-grid { grid-template-columns: 1fr; }
      .list-panel { position: static; max-height: none; }
      .work-stages { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .job { grid-template-columns: 1fr auto; }
      .job > :nth-child(3) { display: none; }
      .experience { grid-template-columns: 1fr; gap: 14px; }
      .overlay { padding: 10px; }
      .modal { max-height: calc(100vh - 20px); }
      .modal-foot .button { flex: 1; }
      .mobile-intake-launch { display: none !important; }
      .confirmation { width: 100%; overflow: hidden; }
      .confirmation > * { min-width: 0; }
      .confirmation h3, .confirmation p, .confirmation .origin-line { overflow-wrap: anywhere; word-break: break-word; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">TS</div><div><strong>天枢</strong><span>奈奈工作操作系统</span></div></div>
      <nav class="nav" aria-label="主导航">
        <button class="active" data-view="today" title="发资料"><span class="nav-icon">01</span><span>发资料</span><span id="count-today" class="nav-count">0</span></button>
        <button data-view="projects" title="项目"><span class="nav-icon">02</span><span>项目</span><span id="count-projects" class="nav-count">0</span></button>
        <button data-view="decision" title="决策"><span class="nav-icon">03</span><span>决策</span><span id="count-decision" class="nav-count">0</span></button>
        <button data-view="action" title="执行"><span class="nav-icon">04</span><span>执行</span><span id="count-action" class="nav-count">0</span></button>
        <button data-view="evolution" title="记忆"><span class="nav-icon">05</span><span>记忆</span><span id="count-evolution" class="nav-count">0</span></button>
      </nav>
      <div class="sidebar-foot"><strong>最终决定：奈奈</strong>SQLite 是唯一正式状态<br>Agent 不能自证完成</div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="top-title"><strong id="top-view-title">发资料</strong><span id="top-context">文字、文件、图片都从这里交给天枢</span></div>
        <div style="display:flex;align-items:center;gap:16px"><span id="live-status" class="live-status" title="等待 SQLite 变化事件">等待实时更新</span><div id="health-status" class="health"><span>SQLite 在线</span></div></div>
      </header>
      <div id="offline" class="offline"></div>
      <div class="content">
        <section id="view-today" class="view active"></section>
        <section id="view-projects" class="view"></section>
        <section id="view-decision" class="view"></section>
        <section id="view-action" class="view"></section>
        <section id="view-evolution" class="view"></section>
      </div>
    </main>
  </div>
  <div id="overlay" class="overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal">
      <div class="modal-head"><div><div id="modal-eyebrow" class="eyebrow">奈奈确认</div><h2 id="modal-title"></h2></div><button id="modal-close" class="icon-button" title="关闭" aria-label="关闭">×</button></div>
      <div id="modal-body" class="modal-body"></div>
      <div class="modal-foot"><button id="modal-cancel" class="button quiet">返回</button><button id="modal-submit" class="button primary">确认提交</button></div>
    </div>
  </div>
  <div id="toast" class="toast" role="status"></div>
  <script>
    (function () {
      function makeClientId(prefix) { return prefix + "-" + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2)); }
      var savedConversationId = localStorage.getItem("tianshu-agenthub-conversation-id");
      var conversationId = savedConversationId || makeClientId("agenthub-cockpit");
      if (!savedConversationId) localStorage.setItem("tianshu-agenthub-conversation-id", conversationId);
      var state = { health: null, today: null, judgments: null, activity: null, evolution: null, agents: [], agentHubSession: null, conversationId: conversationId, view: "today", selectedCard: null, selectedChoice: null, selectedProjectKey: null, modalMode: null, pendingOperation: null, lastIntake: null, deepLinkOpened: false, decisionFilter: "all", attachments: [], speechRecognition: null, resolvedMaterialDialogues: {}, eventSource: null, refreshTimer: null, refreshQueued: false };
      var viewCopy = {
        today: ["发资料", "文字、文件、图片都从这里交给天枢"], projects: ["项目", "项目组合、变化与风险"],
        decision: ["决策", "只处理真正需要你的事项"], action: ["执行", "计划、边界、运行、复核与验收"],
        evolution: ["记忆", "经验如何影响后续判断"]
      };
      var typeLabels = {
        judgment: "判断反馈", outcome: "结果复盘", experience_version: "经验版本", experience_counterexample: "经验反例",
        experience_usage: "效果评价", advisory: "外部建议", workspace: "归属确认", state: "状态变化", project_change: "项目变化",
        plan: "计划确认", execution_configuration: "范围配置", execution: "执行授权", task_start: "启动任务", run_decision: "最终验收"
      };
      var statusLabels = {
        awaiting_creator_feedback: "待你反馈", awaiting_creator_decision: "待你决定", awaiting_creator_confirmation: "待你确认",
        awaiting_approval: "待授权", awaiting_configuration: "待配置", prepared_not_approved: "已准备", candidate: "候选", active: "有效", paused: "已暂停", completed: "已完成",
        retired: "已停用", rejected: "已拒绝", corrected: "已纠正", accepted: "已接受", deferred: "已延后", ignored: "已忽略",
        superseded: "历史版本", not_started: "未开始", pending: "待开始", in_progress: "进行中", blocked: "有阻塞", running: "执行中", verification_passed: "复核通过", verification_failed: "复核失败",
        recovery_required: "需要恢复", queued: "已排队", leased: "已领取", retry_wait: "等待重试", cancel_requested: "取消中", cancelled: "已取消", failed: "失败", succeeded: "成功", approved: "已授权"
      };
      function esc(value) { var raw = String(value == null ? "" : value); if (raw.includes("\ufffd") || /\?{2,}/.test(raw) || /(澶╂灑|濂堝|鏂囦欢|鏉愭枡|璇锋眰|绯荤粺)/.test(raw)) raw = "已收到一批材料"; return raw.replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]; }); }
      function isUnreadable(value) { var valueText = String(value == null ? "" : value); return !valueText.trim() || valueText.includes("\ufffd") || /\?{2,}/.test(valueText) || /(澶╂灑|濂堝|鏂囦欢|鏉愭枡|璇锋眰|绯荤粺)/.test(valueText); }
      function display(value, fallback) { return isUnreadable(value) ? (fallback || "已收到一批材料") : String(value); }
      function customerLocator(value) {
        var locator = display(value, "");
        if (!locator) return "";
        if (/^[A-Za-z]:[\\/]/.test(locator) || /(?:^|[\\/])(?:acceptance|executor_runs|runtime|\.tianshu-runtime)(?:[\\/]|$)/i.test(locator)) return "原始来源已安全保留";
        if (/^https?:\/\//i.test(locator)) { try { return new URL(locator).hostname; } catch (_) { return "网页来源已保留"; } }
        return locator;
      }
      function customerChangeSummary(value, fallback) {
        var summary = display(value, fallback || "项目状态已更新");
        if (/(acceptance|executor_runs|provider|api[_ -]?key|claude|hermes|git|\.md|\.txt|[A-Za-z]:[\\/])/i.test(summary)) return fallback || "开发验收记录已更新";
        return summary;
      }
      function text(value, fallback) { if (value == null || value === "") return fallback || "未记录"; if (typeof value === "object") return value.action || value.then || value.claim || value.summary || value.effect || value.question || value.option || value.note || JSON.stringify(value); return String(value); }
      function date(value, full) { if (!value) return ""; try { return new Intl.DateTimeFormat("zh-CN", full ? { dateStyle: "medium", timeStyle: "short" } : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch (_) { return String(value); } }
      function bytes(value) { var size = Number(value || 0); if (size < 1024) return size + " B"; if (size < 1048576) return Math.round(size / 1024) + " KB"; return (size / 1048576).toFixed(1) + " MB"; }
      function materialKind(item) { return ({ link: "链接", image: "图片", audio: "音频", video: "视频", text: "文本", document: "文档", spreadsheet: "表格", file: "文件" })[item && item.kind] || "文件"; }
      function materialStatus(item) {
        var value = item && item.content_status;
        if (["text_preserved","preserved_text"].includes(value)) return "全文已保留";
        if (["preserved_pending_vision","preserved_pending_transcription","preserved_pending_media_analysis","preserved_binary"].includes(value)) return "原文件已保留，等待识别";
        if (value === "source_preserved_pending_access") return "来源已保留，等待读取";
        if (value === "metadata_only_size_limit") return "仅保留元数据（超过 12 MB）";
        return "材料已登记";
      }
      function attachmentTrayHtml() {
        if (!state.attachments.length) return "";
        return '<div class="attachment-summary"><strong>已选 '+state.attachments.length+' 份材料</strong><span>发送后逐项登记</span></div>'+state.attachments.map(function (item, index) { return '<div class="attachment-item"><div><strong>'+esc(item.name)+'</strong><span>'+materialKind(item)+' · '+bytes(item.size_bytes)+' · '+materialStatus(item)+'</span></div><button class="attachment-remove" data-remove-attachment="'+index+'" type="button">移除</button></div>'; }).join("");
      }
      function intakeGuideHtml() {
        return '<div class="intake-guide"><div class="intake-guide-item"><strong>1. 一次交过来</strong><span>说明、链接、图片、录音和文件可以混合提交</span></div><div class="intake-guide-item"><strong>2. 天枢先整理</strong><span>逐项登记数量与顺序，再判断归属和缺口</span></div><div class="intake-guide-item"><strong>3. 只确认关键问题</strong><span>你核对理解后，才会形成调研或执行计划</span></div></div>';
      }
      function materialListHtml(materials) {
        if (!materials || !materials.length) return "";
        return '<div class="material-list">'+materials.map(function (item, index) { var detail = customerLocator(item.locator || item.source || ""); return '<div class="material-line"><span><strong>'+(index + 1)+'. '+esc(item.name || "未命名材料")+' · '+materialKind(item)+'</strong>'+(detail ? '<small>'+esc(detail)+'</small>' : '')+'</span><span>'+esc(materialStatus(item))+'</span></div>'; }).join("")+'</div>';
      }
      function projectBriefHtml(brief) {
        if (!brief) return "";
        var judgment = brief.judgment || {}; var schedule = brief.schedule || {}; var unknowns = brief.uncertainties || []; var proposal = brief.project_proposal || {}; var outcomes = brief.requested_outcomes || []; var prohibited = brief.prohibited_actions || [];
        return '<div class="brief-panel"><div class="eyebrow">我目前的理解</div><h3>'+esc(brief.title || "素材理解摘要")+'</h3>'+(proposal.positioning ? '<p><strong>当前定位：</strong>'+esc(proposal.positioning)+'</p>' : '')+'<p><strong>目前建议：</strong>'+esc(judgment.recommendation || "继续小范围调研")+'</p>'+(outcomes.length ? '<p><strong>希望得到：</strong>'+outcomes.map(esc).join("、")+'</p>' : '')+(prohibited.length ? '<p><strong>明确不能做：</strong>'+prohibited.map(esc).join("、")+'</p>' : '')+'<p><strong>材料：</strong>'+Number((brief.materials || []).length)+' 项 · <strong>建议时间：</strong>'+esc(schedule.recommended_window || "等待排期")+' · 首轮约 '+esc(schedule.first_pass_effort_minutes || "待估算")+' 分钟</p>'+(unknowns.length ? '<p><strong>还不确定：</strong>'+unknowns.slice(0,3).map(function (item) { return esc(text(item)); }).join("；")+'</p>' : '')+'</div>';
      }
      function inferMaterialKind(file) {
        var type = String(file.type || "").toLowerCase(); var ext = String(file.name || "").split(".").pop().toLowerCase();
        if (type.indexOf("image/") === 0) return "image";
        if (type.indexOf("audio/") === 0) return "audio";
        if (type.indexOf("video/") === 0) return "video";
        if (type.indexOf("text/") === 0 || ["txt","md","csv","json","yaml","yml","xml","html","css","js","ts"].includes(ext)) return "text";
        if (["xls","xlsx","ods"].includes(ext)) return "spreadsheet";
        if (["pdf","doc","docx","ppt","pptx","rtf"].includes(ext)) return "document";
        return "file";
      }
      function readAsDataUrl(file) { return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = reject; reader.readAsDataURL(file); }); }
      async function prepareMaterial(file) {
        var kind = inferMaterialKind(file);
        var material = { name: file.name, size_bytes: file.size, media_type: file.type || "application/octet-stream", kind: kind, last_modified_at: file.lastModified ? new Date(file.lastModified).toISOString() : null, content_status: "metadata_only_size_limit" };
        if (file.size > 12 * 1024 * 1024) return material;
        if (kind === "text") { material.text_content = await file.text(); material.content_status = "preserved_text"; }
        else { material.content_data_url = await readAsDataUrl(file); material.content_status = "preserved_binary"; }
        return material;
      }
      async function addMaterials(files) {
        var incoming = Array.from(files || []); var selected = incoming.slice(0, Math.max(0, 100 - state.attachments.length));
        if (!selected.length) return;
        var prepared = await Promise.all(selected.map(prepareMaterial)); state.attachments = state.attachments.concat(prepared);
        var tray = document.querySelector("#attachment-tray"); if (tray) tray.innerHTML = attachmentTrayHtml();
        if (selected.length < incoming.length) toast("单次最多登记 100 份材料");
      }
      function statusBadge(value) { var label = statusLabels[value] || value || "未开始"; var tone = /active|accepted|completed|passed|succeeded|approved/.test(value || "") ? "active" : /reject|fail|retired|cancel/.test(value || "") ? "rejected" : /candidate|await|defer|recover|queued|prepared/.test(value || "") ? "candidate" : ""; return '<span class="badge '+tone+'">'+esc(label)+'</span>'; }
      function typeTone(type) { return /execution|task_start|run_decision|outcome/.test(type) ? "execution" : /experience/.test(type) ? "learning" : ""; }
      function audit(value) { return '<details class="audit"><summary>查看审计详情</summary><pre>'+esc(JSON.stringify(value, null, 2))+'</pre></details>'; }
      function list(values) { var items = Array.isArray(values) ? values : values == null ? [] : [values]; return items.length ? '<ul>'+items.map(function (item) { return '<li>'+esc(text(item))+'</li>'; }).join("")+'</ul>' : '<span class="muted small">未记录</span>'; }
      function previewBlock(label, content, wide) { return '<div class="preview-block '+(wide ? 'wide' : '')+'"><strong>'+esc(label)+'</strong>'+content+'</div>'; }
      function actor() { return state.today && state.today.decision_authority ? state.today.decision_authority : "local_creator"; }
      async function api(path, options) { var response = await fetch(path, options || {}); var payload = await response.json().catch(function () { return {}; }); if (!response.ok) { var error = new Error(payload.error || ("请求失败 " + response.status)); error.status = response.status; throw error; } return payload; }
      function toast(message) { var el = document.querySelector("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(el._timer); el._timer = setTimeout(function () { el.classList.remove("show"); }, 3000); }
      function setOnline(online, detail) { var banner = document.querySelector("#offline"); banner.classList.toggle("show", !online); banner.textContent = online ? "" : "连接已中断。" + (detail ? " " + detail : " 页面保留当前内容，恢复后会自动刷新。"); var health = document.querySelector("#health-status"); health.classList.toggle("offline", !online); health.querySelector("span").textContent = online ? "SQLite 在线" : "连接中断"; }
      function setLive(connected, detail) { var el = document.querySelector("#live-status"); if (!el) return; el.classList.toggle("connected", connected); el.textContent = connected ? "实时更新已连接" : (detail || "等待实时更新"); el.title = connected ? "SQLite 有变化时页面会自动刷新" : "实时通道断开，页面会自动轮询"; }
      function actionTypes(card) { return ["execution_configuration","execution","task_start","run_decision"].includes(card.type); }
      async function loadAll() {
        try {
          var sessionId = localStorage.getItem("tianshu-agenthub-session-id");
          var sessionRequest = sessionId
            ? api("/v1/channels/agenthub/sessions/"+encodeURIComponent(sessionId)).catch(function (error) { if (error.status === 404) localStorage.removeItem("tianshu-agenthub-session-id"); return null; })
            : Promise.resolve(null);
          var values = await Promise.all([api("/health"), api("/v1/today"), api("/v1/judgments?limit=100"), api("/v1/workspaces/activity?limit=100"), api("/v1/workspaces/evolution?limit=100"), api("/v1/agents"), sessionRequest]);
          state.health = values[0]; state.today = values[1]; state.judgments = values[2]; state.activity = values[3]; state.evolution = values[4]; state.agents = values[5].items || []; state.agentHubSession = values[6];
          setOnline(true); renderAll(); openDeepLinkedConfirmation();
        } catch (error) { setOnline(false, error.message); toast(error.message); }
      }
      function queueRefresh() {
        if (state.refreshQueued) return;
        state.refreshQueued = true;
        setTimeout(function () { state.refreshQueued = false; loadAll(); }, 180);
      }
      function connectEventStream() {
        if (!window.EventSource || state.eventSource) return;
        var stream = new EventSource("/v1/events/stream?after_id=0");
        state.eventSource = stream;
        stream.onopen = function () { setLive(true); if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; } };
        stream.addEventListener("project-change", queueRefresh);
        stream.addEventListener("state-event", queueRefresh);
        stream.onerror = function () { setLive(false, "实时通道重连中"); if (!state.refreshTimer) state.refreshTimer = setInterval(loadAll, 30000); };
      }
      function setView(name) {
        state.view = name;
        if (window.location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
        document.querySelectorAll(".nav button").forEach(function (button) { button.classList.toggle("active", button.dataset.view === name); });
        document.querySelectorAll(".view").forEach(function (view) { view.classList.toggle("active", view.id === "view-" + name); });
        document.querySelector("#top-view-title").textContent = viewCopy[name][0];
        document.querySelector("#top-context").textContent = viewCopy[name][1];
        var intakeLaunch = document.querySelector("#mobile-intake-launch");
        if (intakeLaunch) intakeLaunch.classList.toggle("is-hidden", name === "today");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      function confirmationCard(card) {
        var urgency = card.presentation && card.presentation.urgency;
        var origin = card.origin && card.origin.message ? '<div class="origin-line">来自：'+esc(card.origin.message)+'</div>' : '';
        return '<article class="confirmation '+(urgency === 'high' ? 'urgent' : urgency === 'low' ? 'low' : '')+'"><div><span class="type '+typeTone(card.type)+'">'+esc(typeLabels[card.type] || card.type)+'</span><div class="small muted" style="margin-top:8px">'+esc(date(card.origin && card.origin.created_at))+'</div></div><div><h3>'+esc(card.title)+'</h3><p>'+esc(card.summary)+'</p>'+origin+'</div><button class="button" data-confirm-id="'+esc(card.confirmation_id)+'">'+esc(card.presentation && card.presentation.action_label || "查看并决定")+'</button></article>';
      }
      function assistantTurnHtml(assistant) {
        if (!assistant) return '';
        var card = assistant.card || {}; var receipt = card.receipt || {}; var question = card.question;
        var understanding = card.kind === "understanding_summary";
        var details = understanding
          ? '<div class="conversation-section"><strong>你希望先得到</strong>'+list(card.requested_outcomes)+'</div><div class="conversation-section"><strong>明确不能做</strong>'+list(card.prohibited_actions)+'</div><div class="conversation-section"><strong>还不确定</strong>'+list(card.uncertainties)+'</div><div class="conversation-section"><strong>建议先核实</strong>'+list(card.research_preview)+'</div>'
          : '';
        var receiptLine = receipt.registered_count != null
          ? '<div class="small muted">共登记 '+Number(receipt.registered_count)+' 项 · 顺序已保留 · 来源已保留 · '+Number(receipt.pending_content_count || 0)+' 项内容等待读取或识别</div>'
          : '';
        var questionHtml = question ? '<div class="conversation-question"><strong>'+esc(card.stage_label || "还需要你确认一件事")+'</strong>'+esc(question.text)+'</div>' : '';
        var actions = understanding && card.material_dialogue_id && !state.resolvedMaterialDialogues[card.material_dialogue_id]
          ? '<div class="choices" style="margin-top:14px"><button class="button primary compact" data-material-understanding="confirm" data-material-dialogue-id="'+esc(card.material_dialogue_id)+'">确认理解，生成调研计划</button><button class="button compact" data-material-understanding="revise" data-material-dialogue-id="'+esc(card.material_dialogue_id)+'">我需要修改</button><button class="button compact danger" data-material-understanding="reject" data-material-dialogue-id="'+esc(card.material_dialogue_id)+'">这不是我要的</button></div>'
          : '';
        return '<div class="conversation-assistant"><div class="eyebrow">'+esc(card.display_title || "AgentHub")+'</div><h3>'+esc(card.title || (understanding ? "请核对我的理解" : "素材已登记"))+'</h3><p>'+esc(assistant.text || "已接收")+'</p>'+receiptLine+materialListHtml(receipt.items || [])+questionHtml+details+actions+'<div class="small muted" style="margin-top:13px">尚未启动 Agent，也没有开始执行。</div></div>';
      }
      function conversationHtml() {
        var requests = state.agentHubSession && state.agentHubSession.requests || [];
        if (!requests.length && state.lastIntake) {
          requests = [{ input: { message: state.lastIntake.message || "", materials: state.lastIntake.submittedMaterials || [] }, response: state.lastIntake }];
        }
        if (!requests.length) return '<div class="empty">还没有输入。你说出的目标、资料、客户反馈或问题会先在这里被整理。</div>';
        return '<div class="conversation">'+requests.map(function (request) {
          var input = request.input || {}; var response = request.response || {};
          var user = '<div class="conversation-user">'+esc(input.message || "提交材料")+materialListHtml(input.materials || [])+'</div>';
          return '<div class="conversation-turn">'+user+assistantTurnHtml(response.assistant_message)+'</div>';
        }).join("")+'</div>';
      }
      function lastIntakeHtml() {
        if (state.agentHubSession || state.lastIntake && state.lastIntake.assistant_message) return conversationHtml();
        var latest = state.lastIntake;
        var recent = state.today && state.today.recent_records && state.today.recent_records[0];
        var interaction = latest && latest.interaction;
        var answer = interaction && interaction.answer || recent && recent.answer;
        var message = latest && latest.message || recent && recent.message;
        var workspace = latest && latest.workspace_assignment && (latest.workspace_assignment.effective_workspace || latest.workspace_assignment.proposed_workspace) || recent && recent.workspace;
        var confirmationId = interaction && interaction.plan_candidate && interaction.plan_candidate.candidate_id || recent && recent.confirmation_id;
        var next = answer && answer.next_action || recent && recent.next_action || "等待天枢形成下一步";
        var materials = latest && latest.materials || recent && recent.materials || [];
        var brief = interaction && interaction.project_brief || recent && recent.project_brief;
        if (!message && !answer) return '<div class="empty">还没有输入。你说出的目标、资料、客户反馈或问题会先在这里被整理。</div>';
        return '<div class="result-panel"><div class="eyebrow">天枢刚刚这样理解</div><h3 style="margin-top:7px">'+esc(brief && brief.summary || answer && answer.judgment || "已接收并完成归档")+'</h3><p>'+esc(answer && answer.rationale || message || "输入已进入正式记录")+'</p>'+materialListHtml(materials)+projectBriefHtml(brief)+'<div class="result-grid"><div><strong>原始输入</strong><span>'+esc(message || "仅提交材料")+'</span></div><div><strong>归属</strong><span>'+esc(workspace || "等待确认")+'</span></div><div><strong>下一步</strong><span>'+esc(next)+'</span></div></div>'+(confirmationId ? '<div style="margin-top:15px"><button class="button primary" data-confirm-id="'+esc(confirmationId)+'">打开待确认事项</button></div>' : '')+'</div>';
      }
      function renderReminders() {
        var reminders = state.today && state.today.reminders || [];
        return reminders.length ? reminders.map(function (item) { return '<div class="reminder"><div><strong>'+esc(item.title)+'</strong><div class="small muted">'+esc(date(item.scheduled_for, true))+'</div></div><button class="button compact" data-ack-reminder="'+esc(item.occurrence_id)+'">知道了</button></div>'; }).join("") : '<div class="empty">当前没有到点提醒</div>';
      }
      function renderToday() {
        var t = state.today || {}; var confirmations = (t.confirmations || []).filter(function (card) { return card.context && card.context.visibility !== "hidden"; }); var primary = confirmations.filter(function (card) { return !card.context || card.context.visibility === "primary"; }); var focus = t.focus;
        var focusHtml = focus ? '<div class="focus-panel"><div class="eyebrow">当前唯一焦点</div><div class="focus-title">'+esc(focus.title)+'</div><p>'+esc(focus.reason)+'</p><div class="focus-next"><strong>接下来只推进</strong><br>'+esc(focus.next_action)+'</div></div>' : '<div class="focus-panel"><div class="eyebrow">当前唯一焦点</div><div class="focus-title">还没有可靠焦点</div><p>天枢不会用演示数据替你决定。先输入真实情况。</p></div>';
        var projects = (t.projects || []).slice(0, 3).map(function (project, index) { return projectCard(project, index === 0); }).join("");
        var execution = t.execution_summary || {};
        document.querySelector("#view-today").innerHTML = '<div class="view-head"><div><div class="eyebrow">AgentHub</div><h1>把这一批素材交给天枢</h1><p class="muted">'+esc(new Intl.DateTimeFormat("zh-CN", { dateStyle: "full" }).format(new Date()))+'</p></div></div><div class="grid-main"><div class="column"><section class="section"><div id="intake-composer" class="composer"><textarea id="intake-message" aria-label="告诉天枢" placeholder="可以一次放入说明、链接、客户反馈、录音、图片和文件。天枢会先逐项登记，再只问一个最关键的问题。"></textarea><div class="composer-tools"><input id="intake-materials" type="file" multiple hidden><button id="intake-attach" class="tool-button" type="button">添加材料</button><button id="intake-speech" class="tool-button" type="button">语音输入</button></div><button id="intake-submit" class="button primary">发送给 AgentHub</button><div id="attachment-tray" class="attachment-tray">'+attachmentTrayHtml()+'</div></div><div class="composer-meta"><span>文字、链接、图片、视频、录音与文件进入同一条材料链</span><span>先登记 → 一次反问一件事 → 你核对理解 → 再决定下一步</span><span>单次最多登记 100 份材料</span></div><div id="intake-result">'+lastIntakeHtml()+'</div></section><section class="section"><div class="section-head"><div><h2>需要你决定</h2><p class="muted">素材澄清留在上方对话里，不会混进任务列表</p></div><span class="badge candidate">'+primary.length+' 项</span></div><div class="queue">'+(primary.length ? primary.slice(0, 5).map(confirmationCard).join("") : '<div class="empty">当前没有需要你决定的正式事项</div>')+'</div>'+(primary.length > 5 ? '<div style="margin-top:12px"><button class="button quiet" data-go-view="decision">查看全部 '+primary.length+' 项</button></div>' : '')+'</section><section class="section"><div class="section-head"><div><h2>项目正在发生什么</h2><p class="muted">按当前优先级和最近证据排序</p></div><button class="button quiet" data-go-view="projects">全部项目</button></div><div class="project-list">'+(projects || '<div class="empty">尚未登记可见项目</div>')+'</div></section></div><aside class="column">'+focusHtml+'<section class="section"><div class="section-head"><div><h2>工作流状态</h2></div></div><div class="metric-strip" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="metric"><span class="small muted">待决定</span><strong>'+confirmations.length+'</strong></div><div class="metric"><span class="small muted">已准备</span><strong>'+Number(execution.prepared_tasks || 0)+'</strong></div><div class="metric"><span class="small muted">执行中</span><strong>'+Number(execution.running || 0)+'</strong></div><div class="metric"><span class="small muted">待验收</span><strong>'+Number(execution.awaiting_creator_decision || 0)+'</strong></div></div></section><section class="section"><div class="section-head"><div><h2>到点提醒</h2><p class="muted">'+Number(t.automation_summary && t.automation_summary.active || 0)+' 个自动化运行中</p></div><button class="button compact" data-new-automation>新建</button></div>'+renderReminders()+'</section></aside></div>';
        var intakeComposer = document.querySelector("#intake-composer");
        if (intakeComposer) intakeComposer.insertAdjacentHTML("beforebegin", intakeGuideHtml());
      }
      function projectProgressHtml(project) {
        var progress = project.progress || {}; var current = progress.current; var pending = progress.pending; var percent = current && Number.isInteger(current.percent_complete) ? current.percent_complete : null;
        var label = percent == null ? "尚未建立" : percent + "%";
        var status = current ? (statusLabels[current.status] || current.status) : "等待第一次正式填报";
        var basis = current && current.basis ? (current.basis.kind === "manual_estimate" ? "人工估算" : "按里程碑") : "需要里程碑或交付物依据";
        var pendingHtml = pending ? '<div class="progress-pending">收到新的进度汇报：'+esc(pending.value && pending.value.percent_complete != null ? pending.value.percent_complete + "%" : "待计算")+' · 尚未确认写入正式状态</div>' : '';
        return '<div class="progress-line"><strong>建设进度 '+esc(label)+'</strong><span>'+esc(status)+' · '+esc(basis)+'</span></div>'+(percent == null ? '' : '<div class="progress-track" aria-label="项目建设进度 '+percent+'%"><div class="progress-fill '+(pending ? 'pending' : '')+'" style="width:'+Math.max(0, Math.min(100, percent))+'%"></div></div>')+pendingHtml;
      }
      function projectMaterialSummary(project) {
        var current = project.progress && project.progress.current; var candidates = [current && current.current_outcome];
        var facts = project.current_state && project.current_state.risk && project.current_state.risk.value && project.current_state.risk.value.facts || [];
        candidates = candidates.concat(facts);
        for (var index = 0; index < candidates.length; index += 1) { var match = String(candidates[index] || "").match(/(\d+)\s*(条|项|张|份)/); if (match) return match[1]+' '+match[2]; }
        return null;
      }
      function projectCard(project, featured, selected) {
        var posture = project.posture || {}; var blockers = posture.blockers || []; var meta = [project.priority_label, posture.stage, posture.trend && posture.trend.label, posture.freshness && posture.freshness.label].filter(Boolean);
        var lane = project.project_key === "tianshu" ? "主项目" : "孵化项目";
        return '<article class="project-card '+(featured ? 'featured ' : '')+(selected ? 'selected ' : '')+(project.project_key === "tianshu" ? 'main-project' : '')+'"><div class="project-top"><div><div class="eyebrow">'+lane+'</div><h3 style="margin-top:6px">'+esc(project.display_name)+'</h3></div><div class="score"><strong>'+Number(project.score || 0)+'</strong><small>优先级</small></div></div>'+projectProgressHtml(project)+'<p class="muted" style="margin-top:13px">'+esc(posture.next_outcome || "等待明确下一项可验收结果")+'</p><div class="project-meta">'+meta.map(function (item) { return '<span class="badge">'+esc(item)+'</span>'; }).join("")+'</div>'+(blockers.length ? '<div class="blockers">'+blockers.map(function (item) { return '· '+esc(customerChangeSummary(item, "存在一项待处理风险")); }).join('<br>')+'</div>' : '')+'<div class="project-actions"><button class="button compact" data-project-key="'+esc(project.project_key)+'">'+(selected ? '正在查看' : '查看项目')+'</button></div></article>';
      }
      function projectWorkspaceHtml(project, timeline) {
        if (!project) return '';
        var posture = project.posture || {}; var progress = project.progress || {}; var current = progress.current; var milestones = current && current.milestones || [];
        var materialSummary = projectMaterialSummary(project);
        var milestoneHtml = milestones.length ? milestones.map(function (item) { return '<div class="milestone-item"><span class="milestone-dot '+esc(item.status)+'"></span><strong>'+esc(item.title)+'</strong><span>'+esc(statusLabels[item.status] || item.status)+'</span></div>'; }).join('') : '<div class="empty">尚未建立可验收里程碑，因此不会虚构完成百分比。</div>';
        var recent = timeline.filter(function (item) { return item.project_key === project.project_key; }).slice(0, 5).map(function (item) { return '<div class="work-item"><div class="work-head"><div><strong>'+esc(customerChangeSummary(item.summary || item.change_type))+'</strong><div class="small muted">'+esc(date(item.created_at, true))+'</div></div>'+statusBadge(item.status)+'</div></div>'; }).join('');
        return '<div id="project-workspace" class="project-workspace"><div class="workspace-summary"><div><div class="eyebrow">项目工作台</div><h2 style="margin-top:6px">'+esc(project.display_name)+'</h2></div><div class="workspace-stat primary"><span class="small muted">建设进度</span><strong>'+(current ? Number(current.percent_complete)+'%' : '尚未建立')+'</strong><span class="workspace-stat-note">只计算已经实际完成的建设，不把收资料算成进度</span></div>'+(materialSummary ? '<div class="workspace-stat material" data-material-count="1"><span class="small muted">已收资料</span><strong>'+esc(materialSummary)+'</strong><span class="workspace-stat-note">材料是判断输入，不自动代表项目已开始建设</span></div>' : '')+'<div class="workspace-stat"><span class="small muted">当前阶段</span><strong>'+esc(current && current.stage || posture.stage || '等待明确阶段')+'</strong></div><div class="workspace-stat"><span class="small muted">下一步</span><strong>'+esc(current && current.next_action || posture.next_outcome || '等待明确下一项可验收结果')+'</strong></div>'+(current && current.blockers && current.blockers.length ? '<div class="blockers"><strong>当前卡点</strong><br>'+current.blockers.map(function (item) { return '· '+esc(item); }).join('<br>')+'</div>' : '')+'</div><div><div class="section-head"><div><h3>做到哪一步</h3><p class="muted">每一步都要有可核对的交付物或证据</p></div></div><div class="milestone-list">'+milestoneHtml+'</div><div class="detail-section"><h3>最近更新</h3>'+(recent || '<div class="empty">暂无项目更新</div>')+'</div></div></div>';
      }
      function renderProjects() {
        var t = state.today || {}; var projects = t.projects || [];
        if (!state.selectedProjectKey || !projects.some(function (item) { return item.project_key === state.selectedProjectKey; })) state.selectedProjectKey = projects[0] && projects[0].project_key;
        var selected = projects.find(function (item) { return item.project_key === state.selectedProjectKey; }); var rawTimeline = t.project_timeline || [];
        var timeline = rawTimeline.slice(0, 12).map(function (item) { return '<div class="work-item"><div class="work-head"><div><strong>'+esc(item.display_name)+'</strong><p class="muted">'+esc(customerChangeSummary(item.summary || item.change_type))+'</p></div>'+statusBadge(item.status)+'</div><div class="small muted" style="margin-top:7px">'+esc(date(item.created_at, true))+'</div></div>'; }).join("");
        document.querySelector("#view-projects").innerHTML = '<div class="view-head"><div><div class="eyebrow">Portfolio</div><h1>项目组合</h1><p class="muted">小项目先被整理和判断，不会一股脑挤进主线</p></div><span class="badge">隐藏受保护项目 '+Number(t.protected_project_count || 0)+'</span></div><section class="section" id="projectAlignmentDetails"><div class="project-list">'+(projects.length ? projects.map(function (item, index) { return projectCard(item, index === 0, item.project_key === state.selectedProjectKey); }).join("") : '<div class="empty">尚未登记可见项目</div>')+'</div>'+projectWorkspaceHtml(selected, rawTimeline)+'</section><section class="section" style="margin-top:34px"><div class="section-head"><div><h2>最近项目变化</h2><p class="muted">候选变化只有经你确认才进入正式状态</p></div></div><div>'+ (timeline || '<div class="empty">还没有项目变化记录</div>') +'</div></section>';
      }
      function renderDecision() {
        var allConfirmations = (state.today && state.today.confirmations || []).filter(function (card) {
          return !actionTypes(card) && (!card.context || card.context.visibility !== "hidden");
        });
        var confirmations = state.decisionFilter === "acceptance"
          ? allConfirmations.filter(function (card) { return card.context && card.context.context_kind === "acceptance"; })
          : allConfirmations.filter(function (card) { return !card.context || card.context.visibility !== "secondary"; });
        var filtered = confirmations.filter(function (card) { if (state.decisionFilter === "urgent") return card.presentation && card.presentation.urgency === "high"; if (state.decisionFilter === "project") return ["workspace","state","project_change","plan"].includes(card.type); if (state.decisionFilter === "learning") return /experience|outcome|judgment/.test(card.type); return true; });
        var items = state.judgments && state.judgments.items || [];
        var history = items.slice(0, 12).map(function (item) { return '<div class="work-item"><div class="work-head"><div><strong>'+esc(item.question)+'</strong><p class="muted">'+esc(text(item.recommendation, "暂无建议"))+'</p></div>'+statusBadge(item.status)+'</div><div class="small muted" style="margin-top:8px">'+esc(date(item.created_at, true))+' · '+esc(item.workspace || "未归属")+'</div></div>'; }).join("");
        document.querySelector("#view-decision").innerHTML = '<div class="view-head"><div><div class="eyebrow">Decision inbox</div><h1>需要你做的决定</h1><p class="muted">原始输入、天枢理解、边界和影响放在同一处</p></div><span class="badge candidate">'+filtered.length+' 项</span></div><div class="choices" data-filter-group>'+[["all","全部"],["urgent","高优先级"],["project","项目与计划"],["learning","判断与经验"],["acceptance","开发记录"]].map(function (choice) { return '<button class="choice '+(state.decisionFilter === choice[0] ? 'selected' : '')+'" data-decision-filter="'+choice[0]+'">'+choice[1]+'</button>'; }).join("")+'</div><section class="section"><div class="queue">'+(filtered.length ? filtered.map(confirmationCard).join("") : '<div class="empty">现在没有需要你决定的正式事项。还在整理中的材料，请回到“发资料”查看天枢的问题。</div>')+'</div></section><section class="section" style="margin-top:36px"><div class="section-head"><div><h2>判断历史</h2><p class="muted">天枢原判断和你的纠正同时保留</p></div></div>'+(history || '<div class="empty">还没有正式判断</div>')+'</section>';
      }
      function renderAction() {
        var activity = state.activity || {}; var goals = activity.goals || []; var allConfirmations = state.today && state.today.confirmations || []; var actionCards = allConfirmations.filter(actionTypes); var pendingPlanCount = allConfirmations.filter(function (card) { return card.type === "plan"; }).length; var execution = state.today && state.today.execution_summary || {};
        var registeredAgents = (state.agents || []).filter(function (agent) { return agent.status === "registered"; });
        var executor = registeredAgents.find(function (agent) { return (agent.capabilities || []).includes("workspace_write"); });
        var reviewer = registeredAgents.find(function (agent) { return (agent.capabilities || []).includes("independent_review"); });
        var workerReady = Boolean(state.health && state.health.worker && state.health.worker.running);
        var verifiedRun = actionCards.some(function (card) { return card.type === "run_decision"; });
        var successfulRun = (activity.jobs || []).some(function (job) { return ["succeeded", "completed", "verified", "accepted"].includes(job.status); });
        var realRunLabel = verifiedRun ? "已有待验收结果" : successfulRun ? "已完成一次执行与复核" : "尚待一次真实验收";
        var realRunDetail = verifiedRun ? "Claude 已执行、Hermes 已复核，正在等你点验收结果。" : successfulRun ? "执行和独立复核链路已有实际成功记录。" : "代码链路已具备，但还不能诚实地称为完全验证可用。";
        var readiness = '<section class="section" style="margin-top:32px"><div class="section-head"><div><h2>真实协作准备情况</h2><p class="muted">这里说的是系统实际状态，不用“已接入”代替“已验收”。</p></div></div><div class="readiness-grid"><article class="readiness-item '+(workerReady ? 'ready' : 'pending')+'"><span class="small muted">任务调度服务</span><strong>'+(workerReady ? '运行中' : '尚未运行')+'</strong><p class="small muted">'+(workerReady ? '可以接收已经授权的任务。' : '服务未运行，暂时不能接任务。')+'</p></article><article class="readiness-item '+(executor && reviewer ? 'ready' : 'pending')+'"><span class="small muted">执行与独立复核</span><strong>'+(executor && reviewer ? '已登记两个角色' : '角色尚未配齐')+'</strong><p class="small muted">'+(executor && reviewer ? esc(executor.display_name)+' 负责执行；'+esc(reviewer.display_name)+' 独立复核。' : '需要一名执行 Agent 和一名独立复核 Agent。')+'</p></article><article class="readiness-item '+(successfulRun ? 'ready' : 'pending')+'"><span class="small muted">脱离当前对话的真实验收</span><strong>'+realRunLabel+'</strong><p class="small muted">'+realRunDetail+'</p></article></div></section>';
        var work = goals.map(function (goal) { var plans = goal.plans || []; var latest = plans[0] || {}; return '<article class="work-item"><div class="work-head"><div><div class="eyebrow">'+esc(goal.goal_id)+'</div><h3 style="margin-top:6px">'+esc(text(goal.contract && goal.contract.objective, "未命名目标"))+'</h3></div>'+statusBadge(goal.status)+'</div><div class="work-stages"><div class="stage"><strong>计划</strong><br>'+esc(statusLabels[latest.plan_status] || latest.plan_status || "未建立")+'</div><div class="stage"><strong>任务</strong><br>'+esc(statusLabels[latest.task_status] || latest.task_status || "未生成")+'</div><div class="stage"><strong>运行</strong><br>'+esc(statusLabels[latest.run_status] || latest.run_status || "未启动")+'</div><div class="stage"><strong>独立复核</strong><br>'+esc(latest.verifier ? latest.verifier + (latest.passed ? " · 通过" : " · 未通过") : "尚未复核")+'</div></div></article>'; }).join("");
        var jobs = (activity.jobs || []).map(function (job) { var controls = ''; if (job.can_cancel) controls += '<button class="button compact danger" data-job-action="cancel" data-job-id="'+esc(job.job_id)+'">取消</button>'; if (job.can_retry) controls += '<button class="button compact" data-job-action="retry" data-job-id="'+esc(job.job_id)+'">重试</button>'; return '<div class="job"><div><strong>'+esc(job.payload && job.payload.task_id || job.project_id)+'</strong><div class="small muted">'+esc(job.job_id)+'</div></div><div>'+statusBadge(job.status)+'</div><div class="small">尝试 '+Number(job.attempts)+' / '+Number(job.max_attempts)+'</div><div class="job-actions">'+controls+'</div></div>'; }).join("");
        document.querySelector("#view-action").innerHTML = '<div class="view-head"><div><div class="eyebrow">Controlled execution</div><h1>从计划到最终验收</h1><p class="muted">每个门禁都有明确责任人，不把“已运行”写成“已完成”</p></div></div><div class="pipeline"><div class="pipeline-step"><span class="small muted">待确认计划</span><strong>'+pendingPlanCount+'</strong></div><div class="pipeline-step"><span class="small muted">待配置或授权</span><strong>'+actionCards.filter(function (x) { return /execution/.test(x.type); }).length+'</strong></div><div class="pipeline-step"><span class="small muted">待启动</span><strong>'+actionCards.filter(function (x) { return x.type === "task_start"; }).length+'</strong></div><div class="pipeline-step"><span class="small muted">执行与复核</span><strong>'+Number(execution.running || 0)+Number(execution.awaiting_review || 0)+'</strong></div><div class="pipeline-step"><span class="small muted">待最终验收</span><strong>'+Number(execution.awaiting_creator_decision || 0)+'</strong></div></div>'+readiness+'<section class="section" style="margin-top:32px"><div class="section-head"><div><h2>下一道门禁</h2><p class="muted">按顺序完成，不越过奈奈授权</p></div><span class="badge candidate">'+actionCards.length+' 项</span></div><div class="queue">'+(actionCards.length ? actionCards.map(confirmationCard).join("") : '<div class="empty">当前没有待授权或待验收动作</div>')+'</div></section><section class="section" style="margin-top:34px"><div class="section-head"><div><h2>目标轨迹</h2><p class="muted">一眼看清卡在哪个阶段</p></div></div><div class="detail">'+(work || '<div class="empty">尚无正式目标</div>')+'</div></section><section class="section" style="margin-top:34px"><div class="section-head"><div><h2>运行任务</h2><p class="muted">失败、取消和恢复不会被隐藏</p></div></div><div>'+ (jobs || '<div class="empty">当前没有异步任务</div>') +'</div></section>';
      }
      function automationHtml() {
        var automations = state.today && state.today.automations || [];
        return '<div class="section-head"><div><h2>日常节奏</h2><p class="muted">只做提醒，不替你自动同意或执行</p></div><button class="button" data-new-automation>新建提醒</button></div><div class="automation-list">'+(automations.length ? automations.map(function (item) { var next = item.status === "completed" ? "已完成" : date(item.next_run_at, true); var control = item.status === "completed" ? '' : '<button class="button compact" data-automation-status="'+(item.status === 'active' ? 'paused' : 'active')+'" data-automation-id="'+esc(item.automation_id)+'">'+(item.status === 'active' ? '暂停' : '恢复')+'</button>'; return '<div class="automation"><div><strong>'+esc(item.title)+'</strong><div class="small muted">'+esc(item.schedule_kind === "daily" ? "每天 · " + next : "一次 · " + next)+'</div></div>'+statusBadge(item.status)+control+'</div>'; }).join("") : '<div class="empty">还没有定时提醒</div>')+'</div>';
      }
      function renderEvolution() {
        var experiences = state.evolution && state.evolution.experiences || []; var cards = (state.today && state.today.confirmations || []).filter(function (card) { return /^experience/.test(card.type); });
        var html = experiences.map(function (item) { var current = item.current_version; var rule = current && current.rule || item.pending_version && item.pending_version.rule; var confirmedCounter = (item.counterexamples || []).filter(function (x) { return x.status === "confirmed"; }).length; return '<article class="experience"><div><div class="eyebrow">Experience</div><h3 style="margin-top:6px">'+esc(item.title)+'</h3><div style="margin-top:9px">'+statusBadge(item.status)+(current ? ' <span class="badge">v'+Number(current.version)+'</span>' : '')+'</div></div><div><div class="small muted">当前有效规则</div><div class="rule" style="margin-top:7px">'+esc(text(rule, "尚无有效版本"))+'</div></div><div><div class="small muted">实际使用</div><p style="margin-top:7px">引用 '+Number(item.usage_summary && item.usage_summary.total || 0)+' 次<br>有帮助 '+Number(item.usage_summary && item.usage_summary.helpful || 0)+' 次<br>已确认反例 '+confirmedCounter+' 条</p></div></article>'; }).join("");
        document.querySelector("#view-evolution").innerHTML = '<div class="view-head"><div><div class="eyebrow">Memory and rhythm</div><h1>记忆与日常节奏</h1><p class="muted">经验有版本、有反例；提醒有时间，但都不越过你的决定</p></div></div>'+(cards.length ? '<section class="section"><div class="section-head"><div><h2>经验待确认</h2><p class="muted">候选经验不会自动改变后续判断</p></div></div><div class="queue">'+cards.map(confirmationCard).join("")+'</div></section>' : '')+'<section class="section" style="margin-top:34px"><div class="section-head"><div><h2>经验账本</h2><p class="muted">只保留能追溯来源与实际影响的规则</p></div></div>'+(html || '<div class="empty">完成一次真实结果复盘后，经验会出现在这里</div>')+'</section><section class="section" style="margin-top:38px">'+automationHtml()+'</section>';
      }
      function renderCounts() {
        var t = state.today || {}; var confirmations = t.confirmations || [];
        function setCount(id, value, visible) { var item = document.querySelector(id); if (!item) return; item.textContent = String(value); item.hidden = !visible; }
        var decisionCount = confirmations.filter(function (x) { return !actionTypes(x) && (!x.context || x.context.visibility !== "secondary"); }).length;
        var actionCount = confirmations.filter(actionTypes).length;
        var memoryCount = confirmations.filter(function (x) { return /^experience/.test(x.type); }).length;
        setCount("#count-today", 0, false);
        setCount("#count-projects", (t.projects || []).length, (t.projects || []).length > 0);
        setCount("#count-decision", decisionCount, decisionCount > 0);
        setCount("#count-action", actionCount, actionCount > 0);
        setCount("#count-evolution", memoryCount, memoryCount > 0);
      }
      function refreshCustomerProjectLabels() {
        document.querySelectorAll("#view-projects .progress-line strong").forEach(function (item) { item.textContent = item.textContent.replace("完成度", "建设进度"); });
        var workspace = document.querySelector("#project-workspace");
        var project = state.today && (state.today.projects || []).find(function (item) { return item.project_key === state.selectedProjectKey; });
        if (!workspace || !project) return;
        var firstLabel = workspace.querySelector(".workspace-summary .workspace-stat span");
        if (firstLabel) firstLabel.textContent = "建设进度";
        var outcome = project.progress && project.progress.current && project.progress.current.current_outcome || "";
        var match = String(outcome).match(/(\d+)\s*[\u6761\u9879]/);
        if (match && !workspace.querySelector("[data-material-count]")) {
          var stat = document.createElement("div"); stat.className = "workspace-stat"; stat.dataset.materialCount = "1";
          stat.innerHTML = '<span class="small muted">已收资料</span><strong>'+esc(match[1])+" 条（仅作输入，不计入建设进度）"+'</strong>';
          var summary = workspace.querySelector(".workspace-summary"); var firstStat = summary && summary.querySelector(".workspace-stat");
          if (summary && firstStat) firstStat.insertAdjacentElement("afterend", stat);
        }
      }
      function renderAll() { renderToday(); renderProjects(); renderDecision(); renderAction(); renderEvolution(); renderCounts(); refreshCustomerProjectLabels(); bindDynamic(); }
      function bindProjectCards() {
        document.querySelectorAll("[data-project-key]").forEach(function (button) {
          if (button.dataset.projectBound) return;
          button.dataset.projectBound = "1";
          button.addEventListener("click", function () {
            state.selectedProjectKey = button.dataset.projectKey;
            setView("projects");
            renderProjects();
            refreshCustomerProjectLabels();
            bindProjectCards();
            setTimeout(function () { var workspace = document.querySelector("#project-workspace"); if (workspace) workspace.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
          });
        });
      }
      function bindDynamic() {
        bindProjectCards();
        document.querySelectorAll("[data-confirm-id]").forEach(function (button) { button.addEventListener("click", function () { openDecisionModal(findCard(button.dataset.confirmId)); }); });
        document.querySelectorAll("[data-go-view]").forEach(function (button) { button.addEventListener("click", function () { setView(button.dataset.goView); }); });
        document.querySelectorAll("[data-decision-filter]").forEach(function (button) { button.addEventListener("click", function () { state.decisionFilter = button.dataset.decisionFilter; renderAll(); }); });
        document.querySelectorAll("[data-ack-reminder]").forEach(function (button) { button.addEventListener("click", function () { acknowledgeReminder(button.dataset.ackReminder); }); });
        document.querySelectorAll("[data-new-automation]").forEach(function (button) { button.addEventListener("click", openAutomationModal); });
        document.querySelectorAll("[data-automation-status]").forEach(function (button) { button.addEventListener("click", function () { setAutomationStatus(button.dataset.automationId, button.dataset.automationStatus); }); });
        document.querySelectorAll("[data-job-action]").forEach(function (button) { button.addEventListener("click", function () { openJobModal(button.dataset.jobId, button.dataset.jobAction); }); });
        document.querySelectorAll("[data-material-understanding]").forEach(function (button) { button.addEventListener("click", function () { decideMaterialUnderstanding(button.dataset.materialDialogueId, button.dataset.materialUnderstanding); }); });
        var intakeButton = document.querySelector("#intake-submit"); if (intakeButton) intakeButton.addEventListener("click", submitIntake);
        var intakeField = document.querySelector("#intake-message"); if (intakeField) intakeField.addEventListener("keydown", function (event) { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submitIntake(); });
        var attachButton = document.querySelector("#intake-attach"); var materialInput = document.querySelector("#intake-materials");
        if (attachButton && materialInput) attachButton.addEventListener("click", function () { materialInput.click(); });
        if (materialInput) materialInput.addEventListener("change", function () { addMaterials(materialInput.files).catch(function (error) { toast("材料读取失败：" + error.message); }); materialInput.value = ""; });
        var speechButton = document.querySelector("#intake-speech"); if (speechButton) speechButton.addEventListener("click", toggleSpeechInput);
        var composer = document.querySelector("#intake-composer");
        if (composer) {
          composer.addEventListener("click", function (event) { var remove = event.target.closest("[data-remove-attachment]"); if (!remove) return; state.attachments.splice(Number(remove.dataset.removeAttachment), 1); document.querySelector("#attachment-tray").innerHTML = attachmentTrayHtml(); });
          composer.addEventListener("dragover", function (event) { event.preventDefault(); composer.classList.add("dragging"); });
          composer.addEventListener("dragleave", function () { composer.classList.remove("dragging"); });
          composer.addEventListener("drop", function (event) { event.preventDefault(); composer.classList.remove("dragging"); addMaterials(event.dataTransfer.files).catch(function (error) { toast("材料读取失败：" + error.message); }); });
        }
      }
      function toggleSpeechInput() {
        var button = document.querySelector("#intake-speech"); var field = document.querySelector("#intake-message");
        if (state.speechRecognition) { state.speechRecognition.stop(); return; }
        var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) { toast("当前浏览器不支持语音转文字，可直接添加录音材料"); return; }
        var recognition = new Recognition(); var baseText = field.value.trim();
        recognition.lang = "zh-CN"; recognition.continuous = true; recognition.interimResults = true;
        recognition.onresult = function (event) { var transcript = ""; for (var index = event.resultIndex; index < event.results.length; index += 1) transcript += event.results[index][0].transcript; field.value = [baseText, transcript].filter(Boolean).join(baseText ? "\n" : ""); };
        recognition.onerror = function (event) { toast("语音输入中断：" + event.error); };
        recognition.onend = function () { state.speechRecognition = null; if (button) { button.classList.remove("listening"); button.textContent = "语音输入"; } };
        state.speechRecognition = recognition; button.classList.add("listening"); button.textContent = "停止听写"; recognition.start();
      }
      async function submitIntake() {
        var field = document.querySelector("#intake-message"); var button = document.querySelector("#intake-submit"); var message = field.value.trim(); if (!message && !state.attachments.length) { toast("请先输入内容或添加材料"); return; }
        button.disabled = true; button.textContent = "正在整理";
        try { var clientId = makeClientId("agenthub-message"); var submittedMaterials = state.attachments.slice(); var result = await api("/v1/channels/agenthub/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversation_id: state.conversationId, message_id: clientId, idempotency_key: clientId, actor_id: actor(), actor_kind: "creator", message: message, materials: submittedMaterials, metadata: { client: "tianshu-agenthub-cockpit", context_kind: "product" } }) }); state.lastIntake = Object.assign({ message: message || "仅提交材料", submittedMaterials: submittedMaterials }, result); localStorage.setItem("tianshu-agenthub-session-id", result.interaction_contract.session_id); field.value = ""; state.attachments = []; await loadAll(); toast(result.assistant_message && result.assistant_message.card && result.assistant_message.card.kind === "materials_received" ? "素材已逐项登记，请回答一个关键问题" : "理解已更新，请核对"); }
        catch (error) { document.querySelector("#intake-result").innerHTML = '<div class="result-panel error"><strong>这次没有成功进入天枢</strong><p>'+esc(error.message)+'</p></div>'; }
        finally { button.disabled = false; button.textContent = "发送给 AgentHub"; }
      }
      async function decideMaterialUnderstanding(dialogueId, decision) {
        try {
          var result = await api("/v1/material-dialogues/"+encodeURIComponent(dialogueId)+"/understanding-decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: decision, decided_by: actor() }) });
          state.resolvedMaterialDialogues[dialogueId] = true;
          await loadAll();
          if (decision === "confirm") toast("已生成调研计划，请在“需要你决定”中核对");
          else if (decision === "revise") toast(result.dialogue && result.dialogue.current_question && result.dialogue.current_question.text || "请直接补充需要修改的地方");
          else toast("已停止这条材料的后续推进");
        } catch (error) { toast(error.message); }
      }
      function findCard(id) { return (state.today && state.today.confirmations || []).find(function (card) { return card.confirmation_id === id; }); }
      function openDeepLinkedConfirmation() { if (state.deepLinkOpened) return; var requested = new URLSearchParams(window.location.search).get("confirmation"); if (!requested) return; var card = requested === "first" ? state.today && state.today.confirmations && state.today.confirmations[0] : findCard(requested); if (card) { state.deepLinkOpened = true; openDecisionModal(card); } }
      function choiceConfig(card) {
        var interaction = card.result && card.result.interaction || {}; var id = card.confirmation_id;
        var configs = {
          judgment: { route: interaction.decision_route, key: "decision", choices: [["accept","接受判断"],["correct","纠正"],["reject","拒绝"],["defer","稍后"],["ignore","忽略"]] },
          outcome: { route: interaction.decision_route, key: "decision", choices: [["confirm","确认结果"],["correct","纠正结果"],["reject","拒绝结果"]] },
          experience_version: { route: interaction.decision_route, key: "decision", choices: [["activate","激活版本"],["reject","拒绝版本"]] },
          experience_counterexample: { route: interaction.decision_route, key: "decision", choices: [["confirm","确认反例"],["reject","拒绝反例"]] },
          experience_usage: { route: interaction.decision_route, key: "assessment", choices: [["helpful","有帮助"],["harmful","有害"],["neutral","中性"],["unclear","不明确"]] },
          advisory: { route: "/v1/advisory/recommendations/"+encodeURIComponent(id)+"/decision", key: "disposition", choices: [["adopt","采纳"],["adapt","适配后采纳"],["defer","稍后"],["reject","拒绝"]] },
          workspace: { route: "/v1/intakes/"+encodeURIComponent(card.result && card.result.intake_id || "")+"/workspace-decision", key: "decision", choices: [["confirm","确认归属"],["correct","更正归属"]] },
          state: { route: "/v1/state/"+encodeURIComponent(interaction.state_candidate && interaction.state_candidate.subject_id || "")+"/decision", key: "decision", choices: [["accept","接受变化"],["correct","纠正变化"],["reject","拒绝变化"]] },
          project_change: { route: "/v1/project-changes/"+encodeURIComponent(id)+"/decision", key: "decision", choices: [["accept","接受变化"],["reject","拒绝变化"]] },
          plan: { route: "/v1/intakes/"+encodeURIComponent(card.result && card.result.intake_id || "")+"/plan-decision", key: "decision", choices: [["approve","确认计划"],["reject","拒绝计划"]] },
          execution: { route: "/v1/plans/"+encodeURIComponent(id)+"/execution-decision", key: "decision", choices: [["approve","授权执行"],["reject","拒绝执行"]] },
          task_start: { route: "/v1/tasks/"+encodeURIComponent(id)+"/start", key: null, choices: [["start","启动任务"]] },
          run_decision: { route: "/v1/runs/"+encodeURIComponent(id)+"/decision", key: "decision", choices: [["accept","最终接受"],["reject","拒绝结果"]] },
          execution_configuration: { route: "/v1/plans/"+encodeURIComponent(id)+"/execution-boundary", key: "configuration", choices: [["configure","保存执行范围"]] }
        };
        return configs[card.type];
      }
      function previewHtml(card) {
        var i = card.result && card.result.interaction || {}; var html = '';
        if (card.origin && card.origin.message) html += '<div class="source-box"><div class="small muted">来自 '+esc(card.origin.source || "输入")+' · '+esc(date(card.origin.created_at, true))+'</div><strong style="display:block;margin-top:6px">'+esc(card.origin.message)+'</strong></div>';
        html += '<p>'+esc(card.summary)+'</p><div class="preview-grid">';
        if (card.type === "plan") { var p = i.plan_candidate || {}; var brief = p.project_brief; if (brief) { var proposal = brief.project_proposal || {}; html += previewBlock("项目定位", '<p>'+esc(proposal.positioning || "待确认项目线索")+'</p>', true)+previewBlock("天枢建议", '<p>'+esc(brief.judgment && brief.judgment.recommendation)+'</p><div class="small muted">'+esc(brief.judgment && brief.judgment.rationale)+'</div>', true)+previewBlock("材料清单", '<p>共 '+Number((brief.materials || []).length)+' 项</p>'+materialListHtml(brief.materials || []), true)+previewBlock("首轮目标", list(brief.requested_outcomes), false)+previewBlock("禁止事项", list(brief.prohibited_actions), false)+previewBlock("已确认的事实", list(brief.facts), false)+previewBlock("仍需核实", list(brief.uncertainties), false)+previewBlock("建议排期", '<p>'+esc(brief.schedule && brief.schedule.recommended_window)+' · 首轮约 '+esc(brief.schedule && brief.schedule.first_pass_effort_minutes)+' 分钟</p>', true); } html += previewBlock("要达成什么", '<p>'+esc(p.objective || card.title)+'</p>', true)+previewBlock("计划步骤", list(p.proposed_steps), false)+previewBlock("完成标准", list(p.completion_criteria), false)+previewBlock("允许范围", list(p.scope), false)+previewBlock("明确不做", list(p.non_goals), false)+previewBlock("必须提供的证据", list(p.required_evidence), true)+previewBlock("风险等级", '<p>'+esc(p.risk_level || "未评估")+'</p>', false)+previewBlock("执行状态", '<p>尚未启动。确认计划后仍需配置并批准执行边界。</p>', false); }
        else if (["execution_configuration","execution"].includes(card.type)) { var e = i.execution_candidate || {}; html += previewBlock("执行目标", '<p>'+esc(e.objective || card.title)+'</p>', true)+previewBlock("执行 Agent", '<p>'+esc(e.executor_agent || "待选择")+'</p>', false)+previewBlock("独立复核 Agent", '<p>'+esc(e.verifier_agent || "待选择")+'</p>', false)+previewBlock("允许路径", list(e.allowed_paths), true)+previewBlock("超时", '<p>'+esc(e.timeout_ms ? Math.round(e.timeout_ms / 1000) + " 秒" : "待设置")+'</p>', false)+previewBlock("最多尝试", '<p>'+esc(e.max_attempts || "待设置")+'</p>', false); }
        else if (card.type === "task_start") { var task = i.task_candidate || {}; html += previewBlock("本次目标", '<p>'+esc(task.objective || card.title)+'</p>', true)+previewBlock("执行者", '<p>'+esc(task.executor_agent)+'</p>', false)+previewBlock("复核者", '<p>'+esc(task.verifier_agent)+'</p>', false)+previewBlock("允许路径", list(task.allowed_paths), true)+previewBlock("启动后", '<p>进入异步队列，执行者完成后自动交给不同 Agent 复核。</p>', true); }
        else if (card.type === "run_decision") { var run = i.run_candidate || {}; html += previewBlock("目标", '<p>'+esc(run.objective || card.title)+'</p>', true)+previewBlock("独立复核", '<p>'+esc(run.verification_passed ? "已通过" : "未通过")+' · '+esc(run.verifier || "未记录")+'</p>', false)+previewBlock("执行结果", '<p>'+esc(text(run.executor, "未提供"))+'</p>', false)+previewBlock("复核报告", '<p>'+esc(text(run.report, "未提供"))+'</p>', true); }
        else if (card.type === "judgment") { var j = i.judgment_candidate || {}; html += previewBlock("建议", '<p>'+esc(text(j.recommendation, "未提供"))+'</p>', true)+previewBlock("事实", list(j.facts), false)+previewBlock("推断", list(j.inferences), false)+previewBlock("不确定性", list(j.uncertainties), true); }
        else if (card.type === "state") { var changes = i.state_candidate && i.state_candidate.decision_card && i.state_candidate.decision_card.changes || []; html += changes.map(function (change) { return previewBlock(change.label || change.key, '<p>'+esc(change.previous)+' → '+esc(change.next)+'</p><div class="small muted">'+esc(change.impact || "")+'</div>', false); }).join(""); }
        else if (card.type === "project_change") { var c = i.project_change_candidate || {}; html += previewBlock("项目", '<p>'+esc(c.project_name || c.project_key)+'</p>', false)+previewBlock("变化类型", '<p>'+esc(c.change_type)+'</p>', false)+previewBlock("原状态", '<p>'+esc(text(c.previous_value))+'</p>', false)+previewBlock("拟更新为", '<p>'+esc(text(c.proposed_value))+'</p>', false); }
        else if (card.type === "workspace") { var w = i.workspace_candidate || {}; html += previewBlock("建议归属", '<p>'+esc(w.proposed_workspace)+'</p>', false)+previewBlock("可信度", '<p>'+esc(w.confidence)+'</p>', false)+previewBlock("候选范围", list(w.candidates), true); }
        else html += previewBlock("候选内容", '<p>'+esc(text(i, card.summary))+'</p>', true);
        html += '</div><div class="consequence"><strong>确认后会发生什么</strong>'+list(card.effects || ["只记录你的决定，不自动执行"] )+'</div>';
        return html;
      }
      function openDecisionModal(card) {
        if (!card) { toast("这项待确认内容已经处理或不存在"); return; }
        state.modalMode = "decision"; state.selectedCard = card; var config = choiceConfig(card); state.selectedChoice = config && config.choices && config.choices[0] && config.choices[0][0] || null;
        document.querySelector("#modal-eyebrow").textContent = "奈奈确认"; document.querySelector("#modal-title").textContent = card.title;
        var choices = config ? config.choices.map(function (choice, index) { return '<button class="choice '+(index === 0 ? 'selected' : '')+'" data-choice="'+esc(choice[0])+'">'+esc(choice[1])+'</button>'; }).join("") : '';
        document.querySelector("#modal-body").innerHTML = previewHtml(card)+'<div class="choices">'+choices+'</div><div id="dynamic-fields">'+dynamicFields(card, state.selectedChoice)+'</div>'+audit(card);
        document.querySelector("#modal-submit").textContent = card.type === "task_start" ? "确认启动" : "确认提交"; document.querySelector("#overlay").classList.add("show");
        document.querySelectorAll("[data-choice]").forEach(function (button) { button.addEventListener("click", function () { state.selectedChoice = button.dataset.choice; document.querySelectorAll("[data-choice]").forEach(function (x) { x.classList.remove("selected"); }); button.classList.add("selected"); document.querySelector("#dynamic-fields").innerHTML = dynamicFields(card, state.selectedChoice); }); });
      }
      function agentField(id, label, selected, exclude) {
        var agents = state.agents || []; if (!agents.length) return '<div class="field"><label>'+label+'</label><input id="'+id+'" value="'+esc(selected || '')+'" placeholder="填写已登记 Agent ID"></div>';
        return '<div class="field"><label>'+label+'</label><select id="'+id+'"><option value="">请选择</option>'+agents.filter(function (agent) { return agent.agent_id !== exclude; }).map(function (agent) { return '<option value="'+esc(agent.agent_id)+'" '+(agent.agent_id === selected ? 'selected' : '')+'>'+esc(agent.display_name)+' · '+esc(agent.agent_id)+'</option>'; }).join("")+'</select></div>';
      }
      function dynamicFields(card, choice) {
        var reasonRequired = ["correct","reject","defer","ignore","harmful"].includes(choice); var html = '';
        if (card.type === "workspace" && choice === "correct") html += '<div class="field"><label>正确归属</label><select id="extra-workspace"><option value="projects">项目</option><option value="life">生活</option><option value="relationships">关系</option><option value="knowledge">知识</option><option value="evolution">进化</option><option value="activity">活动</option><option value="today">今天</option></select></div>';
        if (card.type === "judgment" && choice === "correct") html += '<div class="field"><label>修正后的建议</label><textarea id="extra-text" placeholder="用自己的话写出正确建议"></textarea></div>';
        if (card.type === "outcome" && choice === "correct") html += '<div class="field"><label>修正后的结果摘要</label><textarea id="extra-text" placeholder="实际发生了什么"></textarea></div>';
        if (card.type === "advisory" && choice === "adapt") html += '<div class="field"><label>如何适配</label><textarea id="extra-text" placeholder="保留什么、改掉什么、为什么"></textarea></div>';
        if (card.type === "experience_usage") html += '<div class="field"><label>实际影响</label><textarea id="extra-text" placeholder="这条经验产生了什么帮助或代价"></textarea></div>';
        if (card.type === "state" && choice === "correct") { var changes = card.result.interaction.state_candidate.decision_card.changes || []; html += changes.map(function (change) { return '<div class="field"><label>'+esc(change.label)+' · '+esc(change.key)+'</label><input class="state-correction" data-path="'+esc(change.key)+'" value="'+esc(text(change.raw_next != null ? change.raw_next : change.next, ""))+'"></div>'; }).join(""); }
        if (card.type === "execution_configuration") { var candidate = card.result.interaction.execution_candidate || {}; var first = state.agents[0] && state.agents[0].agent_id; var second = state.agents.find(function (agent) { return agent.agent_id !== first; }); var paths = candidate.allowed_paths && candidate.allowed_paths.length ? candidate.allowed_paths : candidate.workspace_root ? [candidate.workspace_root] : []; html += '<div class="field-row">'+agentField("executor-agent", "执行 Agent", candidate.executor_agent || first, null)+agentField("verifier-agent", "独立复核 Agent", candidate.verifier_agent || second && second.agent_id, null)+'</div><div class="field"><label>允许访问的路径（每行一个）</label><textarea id="allowed-paths">'+esc(paths.join("\n"))+'</textarea></div><div class="field-row"><div class="field"><label>超时毫秒</label><input id="timeout-ms" type="number" min="1000" value="'+esc(candidate.timeout_ms || 300000)+'"></div><div class="field"><label>最多尝试</label><input id="max-attempts" type="number" min="1" max="3" value="'+esc(candidate.max_attempts || 2)+'"></div></div>'; }
        if (card.type !== "task_start" && card.type !== "execution_configuration") html += '<div class="field"><label>理由'+(reasonRequired ? '（必填）' : '（建议填写）')+'</label><textarea id="decision-reason" placeholder="这次决定基于什么"></textarea></div>';
        return html;
      }
      function parseInputValue(value) { var trimmed = value.trim(); if (trimmed === "true") return true; if (trimmed === "false") return false; if (trimmed === "null") return null; if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed); if ((trimmed[0] === "{" && trimmed.endsWith("}")) || (trimmed[0] === "[" && trimmed.endsWith("]"))) { try { return JSON.parse(trimmed); } catch (_) {} } return value; }
      function setPath(root, path, value) { var parts = path.split("."); var cursor = root; parts.forEach(function (part, index) { if (index === parts.length - 1) cursor[part] = value; else { if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {}; cursor = cursor[part]; } }); }
      async function submitDecision() {
        var card = state.selectedCard; var choice = state.selectedChoice; var config = choiceConfig(card); if (!config || !choice) return;
        var reasonField = document.querySelector("#decision-reason"); var reason = reasonField ? reasonField.value.trim() : "";
        if (["correct","reject","defer","ignore","harmful"].includes(choice) && !reason) { toast("请先说明这次决定的理由"); return; }
        var payload = { decided_by: actor(), reason: reason }; if (config.key) payload[config.key] = choice;
        if (card.type === "workspace" && choice === "correct") payload.workspace = document.querySelector("#extra-workspace").value;
        if (card.type === "judgment" && choice === "correct") payload.correction = { recommendation: { action: document.querySelector("#extra-text").value.trim() } };
        if (card.type === "outcome" && choice === "correct") payload.correction = { summary: document.querySelector("#extra-text").value.trim() };
        if (card.type === "advisory" && choice === "adapt") payload.adaptation = { note: document.querySelector("#extra-text").value.trim() };
        if (card.type === "experience_usage") { payload.impact = { creator_note: document.querySelector("#extra-text").value.trim() }; payload.evidence = []; delete payload.reason; delete payload.decided_by; payload.evaluated_by = actor(); }
        if (card.type === "state") { payload.cycle_id = card.result.interaction.state_candidate.cycle_id; if (choice === "correct") { var current = await api("/v1/state/"+encodeURIComponent(card.result.interaction.state_candidate.subject_id)); var corrected = structuredClone(current.state); document.querySelectorAll(".state-correction").forEach(function (input) { setPath(corrected, input.dataset.path, parseInputValue(input.value)); }); payload.corrected_state = corrected; } }
        if (card.type === "execution_configuration") { payload = { executor_agent: document.querySelector("#executor-agent").value.trim(), verifier_agent: document.querySelector("#verifier-agent").value.trim(), allowed_paths: document.querySelector("#allowed-paths").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), timeout_ms: Number(document.querySelector("#timeout-ms").value), max_attempts: Number(document.querySelector("#max-attempts").value) }; if (!payload.executor_agent || !payload.verifier_agent) { toast("请选择执行 Agent 和独立复核 Agent"); return; } if (payload.executor_agent === payload.verifier_agent) { toast("执行者与复核者必须不同"); return; } if (!payload.allowed_paths.length) { toast("至少填写一个允许访问的路径"); return; } }
        var submit = document.querySelector("#modal-submit"); submit.disabled = true; submit.textContent = "提交中";
        try { await api(config.route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); closeModal(); toast(card.type === "task_start" ? "任务已进入执行队列" : "决定已写入 SQLite"); await loadAll(); }
        catch (error) { toast(error.message); }
        finally { submit.disabled = false; submit.textContent = "确认提交"; }
      }
      function openAutomationModal() { state.modalMode = "automation"; state.selectedCard = null; document.querySelector("#modal-eyebrow").textContent = "日常节奏"; document.querySelector("#modal-title").textContent = "新建提醒"; var tomorrow = new Date(Date.now() + 3600000); tomorrow.setSeconds(0,0); var local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0,16); document.querySelector("#modal-body").innerHTML = '<div class="field"><label>提醒内容</label><input id="automation-title" placeholder="例如：晚间回顾今天唯一交付"></div><div class="field-row"><div class="field"><label>频率</label><select id="automation-kind"><option value="once">仅一次</option><option value="daily">每天</option></select></div><div class="field"><label>第一次提醒时间</label><input id="automation-time" type="datetime-local" value="'+local+'"></div></div><div class="consequence"><strong>边界</strong><p>到点后只生成提醒，不会替你确认计划、启动 Agent 或对外行动。</p></div>'; document.querySelector("#modal-submit").textContent = "创建提醒"; document.querySelector("#overlay").classList.add("show"); }
      async function submitAutomation() { var title = document.querySelector("#automation-title").value.trim(); var time = document.querySelector("#automation-time").value; if (!title || !time) { toast("请填写提醒内容和时间"); return; } var submit = document.querySelector("#modal-submit"); submit.disabled = true; try { await api("/v1/automations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title, schedule_kind: document.querySelector("#automation-kind").value, next_run_at: new Date(time).toISOString(), timezone: "Asia/Shanghai", decided_by: actor() }) }); closeModal(); toast("提醒已创建"); await loadAll(); } catch (error) { toast(error.message); } finally { submit.disabled = false; } }
      async function acknowledgeReminder(id) { try { await api("/v1/automation-occurrences/"+encodeURIComponent(id)+"/acknowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decided_by: actor() }) }); toast("提醒已确认"); await loadAll(); } catch (error) { toast(error.message); } }
      async function setAutomationStatus(id, status) { try { await api("/v1/automations/"+encodeURIComponent(id)+"/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: status, decided_by: actor() }) }); toast(status === "paused" ? "提醒已暂停" : "提醒已恢复"); await loadAll(); } catch (error) { toast(error.message); } }
      function openJobModal(jobId, action) { state.modalMode = "job"; state.pendingOperation = { jobId: jobId, action: action }; document.querySelector("#modal-eyebrow").textContent = "运行控制"; document.querySelector("#modal-title").textContent = action === "cancel" ? "取消这个运行任务？" : "重新尝试这个任务？"; document.querySelector("#modal-body").innerHTML = '<div class="consequence"><strong>'+esc(action === "cancel" ? "取消的结果" : "重试的结果")+'</strong><p>'+esc(action === "cancel" ? "任务会停止或进入取消状态，不会被记录成成功。已产生的证据仍会保留。" : "系统会新增一次受相同执行边界约束的尝试，不会覆盖之前的失败记录。")+'</p></div><div class="source-box"><span class="small muted">任务 ID</span><strong style="display:block;margin-top:5px">'+esc(jobId)+'</strong></div>'; document.querySelector("#modal-submit").textContent = action === "cancel" ? "确认取消" : "确认重试"; document.querySelector("#modal-submit").className = "button "+(action === "cancel" ? "danger" : "primary"); document.querySelector("#overlay").classList.add("show"); }
      async function submitJobOperation() { var operation = state.pendingOperation; var submit = document.querySelector("#modal-submit"); submit.disabled = true; try { await api("/v1/jobs/"+encodeURIComponent(operation.jobId)+"/"+operation.action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decided_by: actor() }) }); closeModal(); toast(operation.action === "cancel" ? "取消请求已写入" : "任务已重新排队"); await loadAll(); } catch (error) { toast(error.message); } finally { submit.disabled = false; } }
      function closeModal() { document.querySelector("#overlay").classList.remove("show"); document.querySelector("#modal-submit").className = "button primary"; state.selectedCard = null; state.selectedChoice = null; state.modalMode = null; state.pendingOperation = null; }
      function submitCurrentModal() { if (state.modalMode === "decision") return submitDecision(); if (state.modalMode === "automation") return submitAutomation(); if (state.modalMode === "job") return submitJobOperation(); }
      document.querySelectorAll(".nav button").forEach(function (button) { button.addEventListener("click", function () { setView(button.dataset.view); }); });
      document.querySelector("#modal-close").addEventListener("click", closeModal); document.querySelector("#modal-cancel").addEventListener("click", closeModal); document.querySelector("#modal-submit").addEventListener("click", submitCurrentModal); document.querySelector("#overlay").addEventListener("click", function (event) { if (event.target.id === "overlay") closeModal(); });
      window.addEventListener("online", loadAll); window.addEventListener("offline", function () { setOnline(false); });
      var initialView = window.location.hash.slice(1); setView(["today","projects","decision","action","evolution"].includes(initialView) ? initialView : "today"); loadAll(); connectEventStream(); state.refreshTimer = setInterval(loadAll, 60000);
    })();
  </script>
</body>
</html>`;
