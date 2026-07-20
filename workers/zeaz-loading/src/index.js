const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(brandName) {
  const brand = escapeHtml(brandName || "ZEAZDEV COMPANY LIMITED");

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07120f">
  <meta name="robots" content="index,follow">
  <meta name="description" content="ZEAZDEV COMPANY LIMITED — technology and intelligent systems, currently preparing for launch.">
  <title>${brand}</title>
  <style>
    :root {
      color-scheme: dark;
      --ink: #f4f7f1;
      --muted: #9baaa2;
      --line: rgba(192, 255, 213, 0.16);
      --glow: #68f5a0;
      --lime: #bcff69;
      --night: #07120f;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      min-height: 100svh;
      overflow: hidden;
      color: var(--ink);
      background:
        radial-gradient(circle at 78% 18%, rgba(104, 245, 160, 0.13), transparent 27rem),
        radial-gradient(circle at 12% 85%, rgba(188, 255, 105, 0.08), transparent 25rem),
        var(--night);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body::before {
      position: fixed;
      inset: 0;
      z-index: -1;
      content: "";
      opacity: 0.42;
      background-image:
        linear-gradient(var(--line) 1px, transparent 1px),
        linear-gradient(90deg, var(--line) 1px, transparent 1px);
      background-size: 64px 64px;
      mask-image: linear-gradient(to bottom, black, transparent 80%);
    }
    main {
      width: min(1120px, calc(100% - 40px));
      min-height: 100svh;
      margin: 0 auto;
      display: grid;
      align-content: center;
      gap: clamp(3rem, 8vh, 6rem);
      padding: 40px 0;
    }
    .eyebrow {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .mark {
      width: 12px;
      height: 12px;
      border: 2px solid var(--glow);
      border-radius: 50%;
      box-shadow: 0 0 24px rgba(104, 245, 160, 0.8);
      animation: pulse 2.4s ease-in-out infinite;
    }
    h1 {
      max-width: 900px;
      margin: 22px 0 18px;
      font-size: clamp(3rem, 9.5vw, 8.4rem);
      font-weight: 650;
      letter-spacing: -0.075em;
      line-height: 0.84;
    }
    h1 span { color: var(--lime); }
    .lead {
      max-width: 680px;
      margin: 0;
      color: var(--muted);
      font-size: clamp(1rem, 2vw, 1.25rem);
      line-height: 1.65;
    }
    .status {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 18px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .track {
      height: 2px;
      overflow: hidden;
      background: var(--line);
    }
    .track::after {
      display: block;
      width: 35%;
      height: 100%;
      content: "";
      background: linear-gradient(90deg, transparent, var(--glow), transparent);
      animation: scan 2.8s ease-in-out infinite;
    }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      color: #738079;
      font-size: 0.72rem;
      letter-spacing: 0.06em;
    }
    @keyframes pulse {
      50% { opacity: 0.4; transform: scale(0.82); }
    }
    @keyframes scan {
      from { transform: translateX(-100%); }
      to { transform: translateX(390%); }
    }
    @media (max-width: 640px) {
      main { width: min(100% - 28px, 1120px); }
      h1 { letter-spacing: -0.06em; }
      .status { grid-template-columns: 1fr auto; }
      .track { grid-column: 1 / -1; grid-row: 2; }
      footer { flex-direction: column; gap: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .mark, .track::after { animation: none; }
    }
  </style>
</head>
<body>
  <main>
    <section aria-labelledby="company-name">
      <div class="eyebrow"><span class="mark" aria-hidden="true"></span>${brand}</div>
      <h1 id="company-name">Building what<br>comes <span>next.</span></h1>
      <p class="lead">
        เรากำลังเตรียมพื้นที่ดิจิทัลแห่งใหม่สำหรับเทคโนโลยีและระบบอัจฉริยะ
        Our new digital home is currently taking shape.
      </p>
    </section>
    <section class="status" aria-label="Launch status">
      <span>System initialization</span>
      <div class="track" aria-hidden="true"></div>
      <span>Coming soon</span>
    </section>
    <footer>
      <span>© ${new Date().getUTCFullYear()} ${brand}</span>
      <span>Bangkok, Thailand</span>
    </footer>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...SECURITY_HEADERS, Allow: "GET, HEAD" },
      });
    }

    const body = request.method === "HEAD" ? null : page(env.BRAND_NAME);
    return new Response(body, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Cache-Control": "public, max-age=300",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  },
};
